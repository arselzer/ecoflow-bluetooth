import {
  UUID_WRITE, UUID_NOTIFY, UUID_NUS_WRITE, UUID_NUS_NOTIFY,
  MANUFACTURER_ID, BLE_NAME_PREFIXES, DEVICE_PREFIXES, BLE_NAME_MAP,
  TYPE1_PREFIXES, FRAME_TYPE_COMMAND, SRC_APP, DST_DEVICE,
} from './constants';
import { deriveType1Keys, encryptAesCbc, decryptAesCbc, type SessionKeys } from './crypto';
import { buildPacket, buildEncPacket, parsePacket, parseEncPacket, detectPacketType } from './packet';
import { parseTelemetryDetailed, identifyHeartbeat } from './telemetry';
import { toHex, fromHex, concatBytes } from './utils';
import type { ConnectionState, TelemetryData, LogEntry, DeviceInfo } from './types';

export type ConnectionEventHandler = {
  onStateChange: (state: ConnectionState) => void;
  onTelemetry: (data: TelemetryData) => void;
  onLog: (entry: LogEntry) => void;
  onRawPacket: (direction: 'tx' | 'rx', data: Uint8Array) => void;
  onDeviceInfo: (info: DeviceInfo) => void;
};

export class EcoFlowConnection {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private writeChar: BluetoothRemoteGATTCharacteristic | null = null;
  private notifyChar: BluetoothRemoteGATTCharacteristic | null = null;

  private sessionKeys: SessionKeys | null = null;
  private serialNumber: string | null = null;
  private encryptionType: number = 0; // 0=unknown, 1=MD5, 7=ECDH
  private packetBuffer: Uint8Array = new Uint8Array(0);
  private statusPollTimer: ReturnType<typeof setInterval> | null = null;
  private autoReconnect = true;
  private reconnectCount = 0;

  private handlers: ConnectionEventHandler;

  constructor(handlers: ConnectionEventHandler) {
    this.handlers = handlers;
  }

  get deviceName(): string | null {
    return this.device?.name ?? null;
  }

  get isEncrypted(): boolean {
    return this.sessionKeys !== null;
  }

  private log(direction: LogEntry['direction'], message: string, data?: string) {
    this.handlers.onLog({ timestamp: Date.now(), direction, message, data });
  }

  async connect(): Promise<void> {
    this.handlers.onStateChange('connecting');
    this.log('info', 'Requesting Bluetooth device...');

    try {
      this.autoReconnect = true;
      this.reconnectCount = 0;

      // Build filter list from known prefixes
      const filters: BluetoothLEScanFilter[] = BLE_NAME_PREFIXES.map(prefix => ({
        namePrefix: prefix,
      }));

      // Also filter by manufacturer data
      filters.push({
        manufacturerData: [{
          companyIdentifier: MANUFACTURER_ID,
        }],
      });

      this.device = await navigator.bluetooth.requestDevice({
        filters,
        optionalServices: [
          '00000001-0000-1000-8000-00805f9b34fb',
          '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART service
        ],
      });

      this.log('info', `Found device: ${this.device.name}`);
      this.identifyDevice();

      this.device.addEventListener('gattserverdisconnected', () => {
        this.log('info', 'Device disconnected');
        this.cleanup();
        if (this.autoReconnect) {
          setTimeout(() => this.attemptReconnect(), 1000);
        } else {
          this.handlers.onStateChange('disconnected');
        }
      });

      // Connect with retries
      this.log('info', 'Connecting to GATT server...');
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          this.server = await this.device.gatt!.connect();
          break;
        } catch (e) {
          if (attempt < 3) {
            this.log('info', `Attempt ${attempt} failed, retrying in 1s...`);
            await new Promise(r => setTimeout(r, 1000));
          } else {
            throw e;
          }
        }
      }

      await this.discoverCharacteristics();

      if (this.notifyChar) {
        this.log('info', 'Subscribing to notifications...');
        await this.notifyChar.startNotifications();
        this.notifyChar.addEventListener('characteristicvaluechanged', this.onNotification.bind(this));
      }

      this.handlers.onStateChange('negotiating');

      // Try Type 1 encryption for River 2 / Delta 2
      if (this.serialNumber && this.encryptionType === 1) {
        this.log('info', `Deriving Type 1 keys from serial: ${this.serialNumber}`);
        this.sessionKeys = await deriveType1Keys(this.serialNumber);
        this.log('info', `AES key: ${toHex(this.sessionKeys.aesKey)}`);
        this.log('info', `IV: ${toHex(this.sessionKeys.iv)}`);
        this.handlers.onStateChange('connected');
        this.log('info', 'Type 1 encryption established. Sending status request...');
        setTimeout(() => this.requestStatus(), 500);
        this.startStatusPolling();
      } else if (this.encryptionType === 7) {
        // Type 7 ECDH — not yet implemented
        this.handlers.onStateChange('connected');
        this.log('info', '--- Type 7 (ECDH) encryption detected ---');
        this.log('info', 'This device requires a full ECDH handshake to communicate.');
        this.log('info', 'The handshake needs a login_key.bin file and EcoFlow user credentials.');
        this.log('info', 'Without authentication, the device will disconnect after ~10 seconds.');
        this.log('info', 'Listening for any data the device might send...');
        this.log('info', 'You can use the Command panel to try raw bytes for exploration.');
        // Don't send unencrypted commands — they won't work and may trigger disconnect
      } else {
        // Unknown encryption type — try direct communication
        this.log('info', 'Encryption type unknown. Attempting unencrypted communication...');
        this.handlers.onStateChange('connected');
        setTimeout(() => this.requestStatus(), 500);
        this.startStatusPolling();
      }

    } catch (error) {
      this.log('error', `Connection failed: ${error}`);
      this.handlers.onStateChange('disconnected');
      throw error;
    }
  }

  private identifyDevice(): void {
    if (!this.device) return;
    const name = this.device.name ?? '';
    let model = 'Unknown';
    this.encryptionType = 0;

    // Extract the portion after "EF-" prefix
    const suffix = name.startsWith('EF-') ? name.substring(3) : name;

    // Strategy 1: Match BLE short name (e.g., "R3P50256" -> "R3P" = River 3 Plus)
    // Try longest prefix match first
    const sortedKeys = Object.keys(BLE_NAME_MAP).sort((a, b) => b.length - a.length);
    for (const shortPrefix of sortedKeys) {
      if (suffix.startsWith(shortPrefix)) {
        const match = BLE_NAME_MAP[shortPrefix];
        model = match.model;
        this.encryptionType = match.encType;
        // The remainder after the model prefix is part of the serial/identifier
        this.serialNumber = suffix;
        break;
      }
    }

    // Strategy 2: Match full serial prefix (if device name IS the serial)
    if (model === 'Unknown') {
      for (const [prefix, deviceModel] of Object.entries(DEVICE_PREFIXES)) {
        if (suffix.startsWith(prefix) || name.startsWith(prefix)) {
          model = deviceModel;
          this.serialNumber = suffix || name;
          if (TYPE1_PREFIXES.some(p => (this.serialNumber ?? '').startsWith(p))) {
            this.encryptionType = 1;
          } else {
            this.encryptionType = 7;
          }
          break;
        }
      }
    }

    // Strategy 3: Unknown device — still store what we know
    if (model === 'Unknown' && suffix) {
      this.serialNumber = suffix;
      this.log('info', `Unknown device model for name "${name}". ` +
        'Please report the BLE name so we can add support.');
    }

    this.log('info', `Device: ${name}, Model: ${model}, Serial: ${this.serialNumber ?? 'unknown'}, Encryption: Type ${this.encryptionType}`);

    this.handlers.onDeviceInfo({
      serialNumber: this.serialNumber ?? name,
      batteryLevel: -1,
      deviceName: name,
      model,
    });
  }

  private async discoverCharacteristics(): Promise<void> {
    if (!this.server) return;

    // Try RFCOMM-style service first (River 2, Delta 2)
    try {
      const service = await this.server.getPrimaryService('00000001-0000-1000-8000-00805f9b34fb');
      this.log('info', 'Found RFCOMM-style service');

      try {
        this.writeChar = await service.getCharacteristic(UUID_WRITE);
        this.log('info', `Write char: ${UUID_WRITE}`);
      } catch {
        this.log('info', 'Write characteristic 0x0002 not found');
      }

      try {
        this.notifyChar = await service.getCharacteristic(UUID_NOTIFY);
        this.log('info', `Notify char: ${UUID_NOTIFY}`);
      } catch {
        this.log('info', 'Notify characteristic 0x0003 not found');
      }

      if (this.writeChar && this.notifyChar) return;
    } catch {
      this.log('info', 'RFCOMM service not found, trying Nordic UART...');
    }

    // Try Nordic UART Service
    try {
      const service = await this.server.getPrimaryService('6e400001-b5a3-f393-e0a9-e50e24dcca9e');
      this.log('info', 'Found Nordic UART service');

      if (!this.writeChar) {
        try {
          this.writeChar = await service.getCharacteristic(UUID_NUS_WRITE);
          this.log('info', `Write char: ${UUID_NUS_WRITE}`);
        } catch {
          this.log('info', 'NUS write characteristic not found');
        }
      }

      if (!this.notifyChar) {
        try {
          this.notifyChar = await service.getCharacteristic(UUID_NUS_NOTIFY);
          this.log('info', `Notify char: ${UUID_NUS_NOTIFY}`);
        } catch {
          this.log('info', 'NUS notify characteristic not found');
        }
      }

      if (this.writeChar && this.notifyChar) return;
    } catch {
      this.log('info', 'Nordic UART service not found');
    }

    // Last resort: discover all services/characteristics
    this.log('info', 'Discovering all services...');
    const services = await this.server.getPrimaryServices();
    this.log('info', `Found ${services.length} services: ${services.map((s: BluetoothRemoteGATTService) => s.uuid).join(', ')}`);

    for (const service of services) {
      const chars = await service.getCharacteristics();
      for (const c of chars) {
        this.log('info', `  ${service.uuid} -> ${c.uuid} [${[
          c.properties.read && 'R',
          c.properties.write && 'W',
          c.properties.writeWithoutResponse && 'WnR',
          c.properties.notify && 'N',
        ].filter(Boolean).join(',')}]`);

        if (!this.writeChar && (c.properties.write || c.properties.writeWithoutResponse)) {
          this.writeChar = c;
        }
        if (!this.notifyChar && c.properties.notify) {
          this.notifyChar = c;
        }
      }
    }

    if (!this.writeChar) this.log('error', 'No writable characteristic found');
    if (!this.notifyChar) this.log('error', 'No notify characteristic found');
  }

  async disconnect(): Promise<void> {
    this.autoReconnect = false;
    this.stopStatusPolling();
    if (this.server?.connected) {
      this.server.disconnect();
    }
    this.cleanup();
    this.handlers.onStateChange('disconnected');
  }

  private startStatusPolling() {
    this.stopStatusPolling();
    this.statusPollTimer = setInterval(() => {
      if (this.writeChar) {
        this.requestStatus();
      }
    }, 10000);
  }

  private stopStatusPolling() {
    if (this.statusPollTimer) {
      clearInterval(this.statusPollTimer);
      this.statusPollTimer = null;
    }
  }

  private async attemptReconnect(): Promise<void> {
    if (!this.autoReconnect || !this.device) return;

    // Don't endlessly reconnect if we can't authenticate
    this.reconnectCount++;
    if (this.reconnectCount > 3) {
      this.log('error', 'Too many reconnect attempts. The device likely requires authentication.');
      if (this.encryptionType === 7) {
        this.log('error', 'This device uses Type 7 (ECDH) encryption which is not yet fully supported.');
        this.log('error', 'The device disconnects because it expects an authentication handshake within ~10 seconds.');
      }
      this.log('info', 'Click Connect to try again manually.');
      this.autoReconnect = false;
      this.handlers.onStateChange('disconnected');
      return;
    }

    this.log('info', `Attempting auto-reconnect (${this.reconnectCount}/3)...`);
    this.handlers.onStateChange('connecting');

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        this.server = await this.device.gatt!.connect();
        this.log('info', `Reconnected on attempt ${attempt}`);

        await this.discoverCharacteristics();

        if (this.notifyChar) {
          await this.notifyChar.startNotifications();
          this.notifyChar.addEventListener('characteristicvaluechanged', this.onNotification.bind(this));
        }

        // Re-derive keys if we had them
        if (this.serialNumber && this.encryptionType === 1) {
          this.sessionKeys = await deriveType1Keys(this.serialNumber);
        }

        this.handlers.onStateChange('connected');
        this.startStatusPolling();
        return;
      } catch (e) {
        if (attempt < 3) {
          this.log('info', `Reconnect attempt ${attempt} failed, retrying in 2s...`);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    this.log('error', 'Auto-reconnect failed after 3 attempts');
    this.handlers.onStateChange('disconnected');
  }

  private cleanup() {
    this.sessionKeys = null;
    this.packetBuffer = new Uint8Array(0);
    this.stopStatusPolling();
  }

  private async onNotification(event: Event): Promise<void> {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    const data = new Uint8Array(target.value!.buffer);

    this.handlers.onRawPacket('rx', data);

    // Buffer incomplete packets (BLE MTU splits large packets)
    this.packetBuffer = concatBytes(this.packetBuffer, data);

    await this.processBuffer();
  }

  private async processBuffer(): Promise<void> {
    while (this.packetBuffer.length > 0) {
      const type = detectPacketType(this.packetBuffer);

      if (type === 'encrypted') {
        // 0x5A5A packet
        if (this.packetBuffer.length < 6) return;

        const length = this.packetBuffer[4] | (this.packetBuffer[5] << 8);
        const totalLen = 6 + length; // header(6) + payload_with_crc(length)

        if (this.packetBuffer.length < totalLen) return;

        const packetData = this.packetBuffer.slice(0, totalLen);
        this.packetBuffer = this.packetBuffer.slice(totalLen);

        await this.handleEncryptedPacket(packetData);

      } else if (type === 'inner') {
        // 0xAA packet (unencrypted)
        if (this.packetBuffer.length < 5) return;

        const payloadLen = this.packetBuffer[2] | (this.packetBuffer[3] << 8);
        const totalLen = 5 + payloadLen; // header(4) + crc8(1) + body+crc16(payloadLen)

        if (this.packetBuffer.length < totalLen) return;

        const packetData = this.packetBuffer.slice(0, totalLen);
        this.packetBuffer = this.packetBuffer.slice(totalLen);

        this.handleInnerPacket(packetData);

      } else {
        // Unknown data — skip one byte
        this.log('rx', `Unknown byte: 0x${this.packetBuffer[0].toString(16)}`,
          toHex(this.packetBuffer.slice(0, Math.min(20, this.packetBuffer.length))));
        this.packetBuffer = this.packetBuffer.slice(1);
      }
    }
  }

  private handleInnerPacket(data: Uint8Array): void {
    const packet = parsePacket(data);
    if (!packet) {
      this.log('rx', 'Failed to parse inner packet', toHex(data));
      return;
    }

    const heartbeatType = identifyHeartbeat(packet.src, packet.cmdId);
    this.log('rx',
      `[0xAA] v${packet.version} seq=${packet.seq} ${packet.src.toString(16)}->${packet.dst.toString(16)} ` +
      `cmd=${packet.cmdSet.toString(16).padStart(2, '0')}:${packet.cmdId.toString(16).padStart(2, '0')} ` +
      `(${packet.payload.length}B) [${heartbeatType}]`,
      toHex(packet.payload).substring(0, 80),
    );

    // Parse telemetry
    if (packet.payload.length > 0) {
      try {
        const { data: telemetry, fields } = parseTelemetryDetailed(
          packet.payload, packet.src, packet.cmdSet, packet.cmdId,
        );

        for (const field of fields) {
          const valStr = field.unit ? `${field.value} ${field.unit}` : `${field.value}`;
          this.log('info', `  ${field.name} = ${valStr}`, field.rawHex);
        }

        if (Object.keys(telemetry).length > 0) {
          this.handlers.onTelemetry(telemetry);
        }
      } catch (e) {
        this.log('info', `Payload parse error: ${e}`);
      }
    }
  }

  private async handleEncryptedPacket(data: Uint8Array): Promise<void> {
    const enc = parseEncPacket(data);
    if (!enc) {
      this.log('rx', 'Failed to parse encrypted packet', toHex(data));
      return;
    }

    this.log('rx',
      `[0x5A5A] frame=${enc.frameType} type=${enc.payloadType} encrypted=${enc.encryptedPayload.length}B`,
      toHex(data).substring(0, 80),
    );

    if (this.sessionKeys) {
      try {
        const decrypted = await decryptAesCbc(
          enc.encryptedPayload, this.sessionKeys.aesKey, this.sessionKeys.iv,
        );
        this.log('rx', `Decrypted (${decrypted.length}B)`, toHex(decrypted).substring(0, 80));

        // Parse the decrypted data as an inner packet
        this.handleInnerPacket(decrypted);
      } catch (e) {
        this.log('rx', `Decryption failed: ${e}`, toHex(enc.encryptedPayload).substring(0, 60));
      }
    } else {
      this.log('info', 'Encrypted packet received but no session keys.');
      this.log('info', 'If this is a River 2/Delta 2, the serial number may not have been detected correctly.');
      this.log('info', 'For River 3/Delta 3/SHP2/DPU, Type 7 ECDH encryption is required (not yet supported).');
    }
  }

  async requestStatus(): Promise<void> {
    // Request all heartbeat types
    // The device responds with heartbeat data from each subsystem
    this.log('tx', 'Requesting status heartbeats...');

    // For encrypted devices, wrap in EncPacket
    if (this.sessionKeys) {
      // PD heartbeat request
      await this.sendEncryptedCommand(SRC_APP, DST_DEVICE, 0x02, 0x01, new Uint8Array(0));
    } else {
      // Try unencrypted
      await this.sendRawCommand(SRC_APP, DST_DEVICE, 0x02, 0x01, new Uint8Array(0));
    }
  }

  // Send an unencrypted command
  async sendRawCommand(
    src: number,
    dst: number,
    cmdSet: number,
    cmdId: number,
    payload: Uint8Array,
  ): Promise<void> {
    if (!this.writeChar) {
      this.log('error', 'Not connected');
      return;
    }

    const packet = buildPacket(src, dst, cmdSet, cmdId, payload);
    this.log('tx',
      `cmd=${cmdSet.toString(16).padStart(2, '0')}:${cmdId.toString(16).padStart(2, '0')} (${payload.length}B)`,
      toHex(packet).substring(0, 80),
    );
    this.handlers.onRawPacket('tx', packet);

    try {
      await this.writeChar.writeValueWithoutResponse(packet);
    } catch {
      try {
        await this.writeChar.writeValue(packet);
      } catch (e) {
        this.log('error', `Write failed: ${e}`);
      }
    }
  }

  // Send an encrypted command (requires session keys)
  async sendEncryptedCommand(
    src: number,
    dst: number,
    cmdSet: number,
    cmdId: number,
    payload: Uint8Array,
  ): Promise<void> {
    if (!this.writeChar || !this.sessionKeys) {
      this.log('error', 'Not connected or no session keys');
      return;
    }

    const innerPacket = buildPacket(src, dst, cmdSet, cmdId, payload);
    const encrypted = await encryptAesCbc(innerPacket, this.sessionKeys.aesKey, this.sessionKeys.iv);
    const encPacket = buildEncPacket(FRAME_TYPE_COMMAND, encrypted);

    this.log('tx',
      `[ENC] cmd=${cmdSet.toString(16).padStart(2, '0')}:${cmdId.toString(16).padStart(2, '0')} (${payload.length}B)`,
      toHex(encPacket).substring(0, 80),
    );
    this.handlers.onRawPacket('tx', encPacket);

    try {
      await this.writeChar.writeValueWithoutResponse(encPacket);
    } catch {
      try {
        await this.writeChar.writeValue(encPacket);
      } catch (e) {
        this.log('error', `Write failed: ${e}`);
      }
    }
  }

  // Send raw hex bytes directly (for protocol exploration)
  async sendRawBytes(hexData: string): Promise<void> {
    if (!this.writeChar) {
      this.log('error', 'Not connected');
      return;
    }

    const data = fromHex(hexData);
    this.log('tx', `Raw bytes (${data.length}B)`, hexData);
    this.handlers.onRawPacket('tx', data);

    try {
      await this.writeChar.writeValueWithoutResponse(data);
    } catch {
      try {
        await this.writeChar.writeValue(data);
      } catch (e) {
        this.log('error', `Write failed: ${e}`);
      }
    }
  }
}
