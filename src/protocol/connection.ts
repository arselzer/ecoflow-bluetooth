import {
  UUID_WRITE, UUID_NOTIFY, MANUFACTURER_ID,
  BLE_NAME_PREFIXES, DEVICE_PREFIXES, FRAME_TYPE_COMMAND,
} from './constants';
import { encryptAesCbc, decryptAesCbc, type SessionKeys } from './crypto';
import { buildPacket, buildEncPacket, parsePacket, parseEncPacket, detectPacketType } from './packet';
import { parseTelemetryDetailed } from './telemetry';
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
  private packetBuffer: Uint8Array = new Uint8Array(0);
  private statusPollTimer: ReturnType<typeof setInterval> | null = null;
  private autoReconnect = true;

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
          // EcoFlow doesn't use a custom service UUID; characteristics are under
          // the standard GATT service. We request generic access.
          '00000001-0000-1000-8000-00805f9b34fb',
        ],
      });

      this.log('info', `Found device: ${this.device.name}`);

      // Try to parse manufacturer data from the device
      this.parseDeviceAdvertisement();

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

      this.log('info', 'Getting service and characteristics...');

      // Try to find the service containing EcoFlow characteristics
      // EcoFlow uses 16-bit UUID 0x0001, 0x0002, 0x0003 expanded to 128-bit
      let service: BluetoothRemoteGATTService;
      try {
        service = await this.server!.getPrimaryService('00000001-0000-1000-8000-00805f9b34fb');
      } catch {
        // Fallback: try to discover all services
        this.log('info', 'Primary service not found, discovering services...');
        const services = await this.server!.getPrimaryServices();
        this.log('info', `Found ${services.length} services: ${services.map((s: BluetoothRemoteGATTService) => s.uuid).join(', ')}`);
        if (services.length === 0) throw new Error('No GATT services found');
        service = services[0];
      }

      try {
        this.writeChar = await service.getCharacteristic(UUID_WRITE);
        this.log('info', 'Write characteristic found');
      } catch {
        this.log('info', 'Standard write characteristic not found, searching all characteristics...');
        const chars = await service.getCharacteristics();
        this.log('info', `Found ${chars.length} characteristics: ${chars.map((c: BluetoothRemoteGATTCharacteristic) => c.uuid).join(', ')}`);
        // Try to find writable and notifiable characteristics
        for (const c of chars) {
          if (c.properties.write || c.properties.writeWithoutResponse) {
            this.writeChar = c;
            this.log('info', `Using ${c.uuid} for writing`);
          }
          if (c.properties.notify) {
            this.notifyChar = c;
            this.log('info', `Using ${c.uuid} for notifications`);
          }
        }
      }

      if (!this.notifyChar) {
        try {
          this.notifyChar = await service.getCharacteristic(UUID_NOTIFY);
          this.log('info', 'Notify characteristic found');
        } catch {
          this.log('error', 'Notify characteristic not found');
        }
      }

      if (this.notifyChar) {
        this.log('info', 'Subscribing to notifications...');
        await this.notifyChar.startNotifications();
        this.notifyChar.addEventListener('characteristicvaluechanged', this.onNotification.bind(this));
      }

      this.handlers.onStateChange('negotiating');
      this.log('info', 'Connected. Attempting communication...');

      // For unencrypted devices (older firmware / River 2), try direct commands
      // For encrypted devices (V2 protocol), need ECDH handshake
      await this.tryDirectCommunication();

    } catch (error) {
      this.log('error', `Connection failed: ${error}`);
      this.handlers.onStateChange('disconnected');
      throw error;
    }
  }

  private parseDeviceAdvertisement(): void {
    if (!this.device) return;

    const name = this.device.name ?? '';

    // Determine model from device name or known patterns
    let model = 'Unknown';
    for (const [prefix, deviceModel] of Object.entries(DEVICE_PREFIXES)) {
      if (name.includes(prefix)) {
        model = deviceModel;
        break;
      }
    }

    this.log('info', `Device name: ${name}, Model: ${model}`);
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

    this.log('info', 'Attempting auto-reconnect...');
    this.handlers.onStateChange('connecting');

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        this.server = await this.device.gatt!.connect();
        this.log('info', `Reconnected on attempt ${attempt}`);

        const services = await this.server.getPrimaryServices();
        if (services.length > 0) {
          const service = services[0];
          const chars = await service.getCharacteristics();
          for (const c of chars) {
            if (c.properties.write || c.properties.writeWithoutResponse) {
              this.writeChar = c;
            }
            if (c.properties.notify) {
              this.notifyChar = c;
            }
          }
        }

        if (this.notifyChar) {
          await this.notifyChar.startNotifications();
          this.notifyChar.addEventListener('characteristicvaluechanged', this.onNotification.bind(this));
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

  private async tryDirectCommunication(): Promise<void> {
    // Try sending an unencrypted heartbeat request
    // If the device responds, we have unencrypted communication
    // If not, the device requires V2 encryption
    this.log('info', 'Trying direct (unencrypted) communication...');

    try {
      // Send PD heartbeat request (cmdSet=0x02, cmdId=0x01)
      await this.sendRawCommand(0x20, 0x01, 0x02, 0x01, new Uint8Array(0));
      this.handlers.onStateChange('connected');
      this.startStatusPolling();
    } catch (e) {
      this.log('info', `Direct communication attempt: ${e}`);
      this.log('info', 'Device may require V2 encrypted protocol.');
      this.log('info', 'Try using the Command panel to send raw packets for exploration.');
      this.handlers.onStateChange('connected');
      this.startStatusPolling();
    }
  }

  private async onNotification(event: Event): Promise<void> {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    const data = new Uint8Array(target.value!.buffer);

    this.handlers.onRawPacket('rx', data);

    // Buffer incomplete packets (BLE MTU may split large packets)
    this.packetBuffer = concatBytes(this.packetBuffer, data);

    // Try to parse buffered data
    await this.processBuffer();
  }

  private async processBuffer(): Promise<void> {
    while (this.packetBuffer.length > 0) {
      const type = detectPacketType(this.packetBuffer);

      if (type === 'inner') {
        // 0xAA packet
        if (this.packetBuffer.length < 5) return; // Need more data

        const length = this.packetBuffer[2] | (this.packetBuffer[3] << 8);
        const totalLen = 5 + length; // header(4) + crc8(1) + body+crc16(length)

        if (this.packetBuffer.length < totalLen) return; // Incomplete

        const packetData = this.packetBuffer.slice(0, totalLen);
        this.packetBuffer = this.packetBuffer.slice(totalLen);

        await this.handleInnerPacket(packetData);

      } else if (type === 'encrypted') {
        // 0x5A5A packet
        if (this.packetBuffer.length < 6) return;

        const length = this.packetBuffer[4] | (this.packetBuffer[5] << 8);
        const totalLen = 6 + length + 2; // header(6) + payload(length) + crc16(2)

        if (this.packetBuffer.length < totalLen) return;

        const packetData = this.packetBuffer.slice(0, totalLen);
        this.packetBuffer = this.packetBuffer.slice(totalLen);

        await this.handleEncryptedPacket(packetData);

      } else {
        // Unknown data - log and skip one byte
        this.log('rx', `Unknown byte: 0x${this.packetBuffer[0].toString(16)}`, toHex(this.packetBuffer.slice(0, Math.min(20, this.packetBuffer.length))));
        this.packetBuffer = this.packetBuffer.slice(1);
      }
    }
  }

  private async handleInnerPacket(data: Uint8Array): Promise<void> {
    const packet = parsePacket(data);
    if (!packet) {
      this.log('rx', 'Failed to parse inner packet', toHex(data));
      return;
    }

    this.log('rx',
      `[0xAA] seq=${packet.seq} ${packet.src.toString(16)}->${packet.dst.toString(16)} cmd=${packet.cmdSet.toString(16).padStart(2, '0')}:${packet.cmdId.toString(16).padStart(2, '0')} (${packet.payload.length}B)`,
      toHex(data),
    );

    // Try to parse as telemetry
    if (packet.payload.length > 0) {
      try {
        const { data: telemetry, tlvEntries } = parseTelemetryDetailed(
          packet.payload, packet.cmdSet, packet.cmdId,
        );

        for (const entry of tlvEntries) {
          const nameStr = entry.name ? ` (${entry.name})` : ' [UNKNOWN]';
          const valStr = entry.decoded !== null ? ` = ${entry.decoded}${entry.unit ?? ''}` : '';
          this.log('info', `  Field ${entry.fieldNumber}${nameStr}${valStr}`, entry.rawHex);
        }

        if (Object.keys(telemetry).length > 0) {
          this.handlers.onTelemetry(telemetry);
        }
      } catch (e) {
        this.log('info', `Payload parse failed: ${e}`, toHex(packet.payload));
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
      toHex(data),
    );

    if (this.sessionKeys) {
      try {
        const decrypted = await decryptAesCbc(
          enc.encryptedPayload, this.sessionKeys.aesKey, this.sessionKeys.iv,
        );
        this.log('rx', `Decrypted (${decrypted.length}B)`, toHex(decrypted));

        // Try to parse the decrypted data as an inner packet
        await this.handleInnerPacket(decrypted);
      } catch (e) {
        this.log('rx', `Decryption failed: ${e}`);
      }
    } else {
      this.log('info', 'Encrypted packet received but no session keys. V2 encryption handshake required.');
    }
  }

  async requestStatus(): Promise<void> {
    // Send heartbeat requests for all subsystems
    await this.sendRawCommand(0x20, 0x01, 0x02, 0x01, new Uint8Array(0)); // PD heartbeat
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
    this.log('tx', `cmd=${cmdSet.toString(16).padStart(2, '0')}:${cmdId.toString(16).padStart(2, '0')} (${payload.length}B payload)`, toHex(packet));
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

    this.log('tx', `[ENC] cmd=${cmdSet.toString(16).padStart(2, '0')}:${cmdId.toString(16).padStart(2, '0')}`, toHex(encPacket));
    this.handlers.onRawPacket('tx', encPacket);

    try {
      await this.writeChar.writeValueWithoutResponse(encPacket);
    } catch {
      await this.writeChar.writeValue(encPacket);
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
      await this.writeChar.writeValue(data);
    }
  }
}
