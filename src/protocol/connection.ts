import {
  UUID_WRITE, UUID_NOTIFY, UUID_NUS_WRITE, UUID_NUS_NOTIFY,
  MANUFACTURER_ID, BLE_NAME_PREFIXES, DEVICE_PREFIXES, BLE_NAME_MAP,
  TYPE1_PREFIXES, FRAME_TYPE_PROTOCOL, SRC_APP, DST_DEVICE,
} from './constants';
import {
  deriveType1Keys, encryptAesCbc, decryptAesCbc,
  generateECDHKeyPair, computeSharedSecret, getEcdhTypeSize,
  deriveType7InitialKeys, generateType7SessionKey, generateAuthPayload,
  type SessionKeys, type ECDHKeyPair,
} from './crypto';
import {
  buildPacket, buildEncPacket, parsePacket, parseEncPacket,
  detectPacketType, SimplePacketAssembler,
} from './packet';
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

type AuthState =
  | 'idle'
  | 'ecdh_pubkey_sent'
  | 'ecdh_pubkey_received'
  | 'session_key_requested'
  | 'session_key_received'
  | 'auth_status_requested'
  | 'auth_sent'
  | 'authenticated';

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
  private reconnecting = false;

  // Type 7 ECDH state
  private authState: AuthState = 'idle';
  private ecdhKeyPair: ECDHKeyPair | null = null;
  private simpleAssembler = new SimplePacketAssembler();
  private userId: string = '';
  private serialOverride: string = '';

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

  get isAuthenticated(): boolean {
    return this.authState === 'authenticated';
  }

  setUserId(userId: string) {
    this.userId = userId;
  }

  setSerialOverride(serial: string) {
    this.serialOverride = serial;
  }

  private log(direction: LogEntry['direction'], message: string, data?: string) {
    this.handlers.onLog({ timestamp: Date.now(), direction, message, data });
  }

  private connecting = false;

  async connect(): Promise<void> {
    if (this.connecting) return; // prevent duplicate connections
    this.connecting = true;
    this.handlers.onStateChange('connecting');
    this.log('info', 'Requesting Bluetooth device...');

    try {
      this.autoReconnect = true;
      this.reconnectCount = 0;

      const filters: BluetoothLEScanFilter[] = BLE_NAME_PREFIXES.map(prefix => ({
        namePrefix: prefix,
      }));
      filters.push({
        manufacturerData: [{ companyIdentifier: MANUFACTURER_ID }],
      });

      this.device = await navigator.bluetooth.requestDevice({
        filters,
        optionalServices: [
          '00000001-0000-1000-8000-00805f9b34fb',
          '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
        ],
      });

      this.log('info', `Found device: ${this.device.name}`);
      this.identifyDevice();

      this.device.addEventListener('gattserverdisconnected', () => {
        if (this.reconnecting) return; // prevent duplicate reconnect
        this.log('info', 'Device disconnected');
        this.cleanup();
        if (this.autoReconnect) {
          this.reconnecting = true;
          setTimeout(() => { this.reconnecting = false; this.attemptReconnect(); }, 1000);
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

      this.handlers.onStateChange('negotiating');

      // Route to correct auth flow
      if (this.serialNumber && this.encryptionType === 1) {
        await this.type1Auth();
      } else if (this.encryptionType === 7) {
        await this.type7Auth();
      } else {
        this.log('info', 'Unknown encryption. Trying unencrypted...');
        await this.subscribeNotifications();
        this.handlers.onStateChange('connected');
        setTimeout(() => this.requestStatus(), 500);
        this.startStatusPolling();
      }
    } catch (error) {
      this.log('error', `Connection failed: ${error}`);
      this.handlers.onStateChange('disconnected');
      throw error;
    } finally {
      this.connecting = false;
    }
  }

  // ============================================================
  // Type 1 Auth (River 2 / Delta 2)
  // ============================================================
  private async type1Auth(): Promise<void> {
    this.log('info', `Type 1: Deriving keys from serial: ${this.serialNumber}`);
    this.sessionKeys = deriveType1Keys(this.serialNumber!);
    this.log('info', `AES key: ${toHex(this.sessionKeys.aesKey)}`);
    this.log('info', `IV: ${toHex(this.sessionKeys.iv)}`);

    await this.subscribeNotifications();

    // Send auth status query + auth packet
    const authStatusPkt = buildPacket(0x21, 0x35, 0x35, 0x89, new Uint8Array(0));
    await this.sendEncryptedRaw(authStatusPkt);

    if (this.userId && this.serialNumber) {
      const authPayload = generateAuthPayload(this.userId, this.serialNumber);
      const authPkt = buildPacket(0x21, 0x35, 0x35, 0x86, authPayload);
      await this.sendEncryptedRaw(authPkt);
    }

    this.authState = 'authenticated';
    this.handlers.onStateChange('connected');
    this.log('info', 'Type 1 encryption established.');
    setTimeout(() => this.requestStatus(), 500);
    this.startStatusPolling();
  }

  // ============================================================
  // Type 7 Auth (River 3 / Delta 3 / SHP2 / DPU)
  // ============================================================
  private async type7Auth(): Promise<void> {
    if (!this.userId) {
      this.log('error', 'Type 7 requires a User ID. Set it in the connection panel before connecting.');
      this.log('info', 'Get your User ID from the EcoFlow app (ef_uid cookie) or API login.');
      this.handlers.onStateChange('disconnected');
      return;
    }

    this.log('info', 'Type 7: Starting ECDH key exchange...');

    // Step 1: Generate ECDH keypair and send public key
    this.ecdhKeyPair = generateECDHKeyPair();
    this.log('info', `Our public key: ${toHex(this.ecdhKeyPair.publicKeyBytes)}`);

    const pubKeyPayload = concatBytes(
      new Uint8Array([0x01, 0x00]), // prefix
      this.ecdhKeyPair.publicKeyBytes,
    );
    const frame = SimplePacketAssembler.encode(pubKeyPayload);

    this.authState = 'ecdh_pubkey_sent';

    // Subscribe with auth handler for the response
    await this.subscribeNotifications();
    await this.writeBytes(frame);
    this.log('info', 'ECDH public key sent, waiting for device response...');
  }

  // Handle incoming data during Type 7 auth handshake
  private async handleType7AuthData(data: Uint8Array): Promise<boolean> {
    if (this.authState === 'ecdh_pubkey_sent') {
      // Expecting device's public key in a simple frame
      const payload = this.simpleAssembler.parse(data);
      if (!payload) return true; // need more data

      this.log('info', `ECDH response: ${toHex(payload)}`);

      if (payload.length < 3) {
        this.log('error', 'ECDH response too short');
        return true;
      }

      // payload[0] = status?, payload[1] = ?, payload[2] = curve_num
      const curveSize = getEcdhTypeSize(payload[2]);
      const devPubKey = payload.slice(3, 3 + curveSize);
      this.log('info', `Device public key (${devPubKey.length}B): ${toHex(devPubKey)}`);

      // Compute shared secret
      const sharedSecret = computeSharedSecret(this.ecdhKeyPair!.privateKey, devPubKey);
      this.log('info', `Shared secret: ${toHex(sharedSecret)}`);

      // Derive initial encryption keys
      this.sessionKeys = deriveType7InitialKeys(sharedSecret);
      this.log('info', `Initial AES key: ${toHex(this.sessionKeys.aesKey)}`);
      this.log('info', `IV: ${toHex(this.sessionKeys.iv)}`);

      this.authState = 'ecdh_pubkey_received';

      // Step 2: Request session key info
      this.log('info', 'Requesting session key info...');
      const keyReqFrame = SimplePacketAssembler.encode(new Uint8Array([0x02]));
      this.simpleAssembler = new SimplePacketAssembler(); // reset buffer
      this.authState = 'session_key_requested';
      await this.writeBytes(keyReqFrame);
      return true;
    }

    if (this.authState === 'session_key_requested') {
      // Expecting encrypted session key data
      const payload = this.simpleAssembler.parse(data);
      if (!payload) return true;

      this.log('info', `Session key response: ${toHex(payload)}`);

      if (payload[0] !== 0x02) {
        this.log('error', `Unexpected key info type: 0x${payload[0].toString(16)}`);
        return true;
      }

      // Decrypt the key info (skip first byte which is type=0x02)
      const encryptedKeyInfo = payload.slice(1);
      const keyInfo = await decryptAesCbc(encryptedKeyInfo, this.sessionKeys!.aesKey, this.sessionKeys!.iv);
      this.log('info', `Decrypted key info (${keyInfo.length}B): ${toHex(keyInfo)}`);

      // keyInfo: srand (first 16 bytes) + seed (bytes 16-17)
      const srand = keyInfo.slice(0, 16);
      const seed = keyInfo.slice(16, 18);
      this.log('info', `srand: ${toHex(srand)}, seed: ${toHex(seed)}`);

      // Generate final session key
      const finalSessionKey = generateType7SessionKey(seed, srand);
      this.log('info', `Final session key: ${toHex(finalSessionKey)}`);

      // Update encryption with final session key (keep same IV)
      this.sessionKeys = { aesKey: finalSessionKey, iv: this.sessionKeys!.iv, sharedKey: finalSessionKey };
      this.authState = 'session_key_received';

      // Step 3: Query auth status
      this.log('info', 'Querying auth status...');
      const authStatusPkt = buildPacket(0x21, 0x35, 0x35, 0x89, new Uint8Array(0), undefined);
      await this.sendEncryptedRaw(authStatusPkt);
      this.authState = 'auth_status_requested';
      return true;
    }

    if (this.authState === 'auth_status_requested' || this.authState === 'auth_sent') {
      // These responses arrive as encrypted 0x5A5A packets
      // Buffer and try to parse as EncPacket
      this.packetBuffer = concatBytes(this.packetBuffer, data);

      // Try to extract a complete 0x5A5A frame
      const start = findEncPrefix(this.packetBuffer);
      if (start < 0) return true;
      if (start > 0) this.packetBuffer = this.packetBuffer.slice(start);
      if (this.packetBuffer.length < 6) return true;

      const length = this.packetBuffer[4] | (this.packetBuffer[5] << 8);
      const totalLen = 6 + length;
      if (this.packetBuffer.length < totalLen) return true;

      const frameData = this.packetBuffer.slice(0, totalLen);
      this.packetBuffer = this.packetBuffer.slice(totalLen);

      const enc = parseEncPacket(frameData);
      if (!enc || !this.sessionKeys) {
        this.log('error', 'Failed to parse auth response');
        return true;
      }

      try {
        const decrypted = await decryptAesCbc(enc.encryptedPayload, this.sessionKeys.aesKey, this.sessionKeys.iv);
        const innerPkt = parsePacket(decrypted);
        this.log('info', `Auth response decrypted: ${toHex(decrypted).substring(0, 80)}`);

        if (this.authState === 'auth_status_requested') {
          this.log('info', 'Auth status received, sending authentication...');
          this.authState = 'auth_sent';

          const authPayload = generateAuthPayload(this.userId, this.serialNumber!);
          this.log('info', `Auth payload: ${new TextDecoder().decode(authPayload)}`);

          const authPkt = buildPacket(0x21, 0x35, 0x35, 0x86, authPayload, undefined);
          await this.sendEncryptedRaw(authPkt);
          return true;
        }

        if (this.authState === 'auth_sent') {
          // Check for auth error in response
          if (innerPkt && innerPkt.cmdSet === 0x35 && innerPkt.cmdId === 0x86) {
            const errCode = innerPkt.payload.length > 0 ? innerPkt.payload[0] : -1;
            const AUTH_ERRORS: Record<number, string> = {
              0x00: 'Success',
              0x01: 'NeedRefreshToken — re-login to EcoFlow',
              0x02: 'DeviceInternalError',
              0x03: 'DeviceAlreadyBound — device paired to a different account',
              0x04: 'NeedBindInstallFirst — pair device in EcoFlow app first',
              0x05: 'AppSendDataError',
              0x06: 'WrongKey — User ID does not match paired account',
              0x07: 'MaximumDevicesError',
            };
            if (errCode !== 0x00) {
              const errMsg = AUTH_ERRORS[errCode] ?? `Unknown error code: 0x${errCode.toString(16)}`;
              this.log('error', `Authentication failed: ${errMsg}`);
              this.log('error', 'Enter your EcoFlow User ID (ef_uid from app/website cookies) and try again.');
              this.authState = 'idle';
              this.autoReconnect = false;
              this.handlers.onStateChange('disconnected');
              return true;
            }
          }

          this.authState = 'authenticated';
          this.handlers.onStateChange('connected');
          this.log('info', 'Authentication completed! Listening for data...');
          // Send UTC time sync — device expects this after auth to start sending data
          setTimeout(() => this.sendTimeSync(), 200);
          this.startStatusPolling();
          return false; // let remaining data flow to normal processing
        }
      } catch (e) {
        this.log('error', `Auth response decrypt failed: ${e}`);
      }
      return true;
    }

    return false;
  }

  // ============================================================
  // Device identification
  // ============================================================
  private identifyDevice(): void {
    if (!this.device) return;
    const name = this.device.name ?? '';
    let model = 'Unknown';
    this.encryptionType = 0;

    const suffix = name.startsWith('EF-') ? name.substring(3) : name;
    const sortedKeys = Object.keys(BLE_NAME_MAP).sort((a, b) => b.length - a.length);
    for (const shortPrefix of sortedKeys) {
      if (suffix.startsWith(shortPrefix)) {
        const match = BLE_NAME_MAP[shortPrefix];
        model = match.model;
        this.encryptionType = match.encType;
        this.serialNumber = suffix;
        break;
      }
    }

    if (model === 'Unknown') {
      for (const [prefix, deviceModel] of Object.entries(DEVICE_PREFIXES)) {
        if (suffix.startsWith(prefix) || name.startsWith(prefix)) {
          model = deviceModel;
          this.serialNumber = suffix || name;
          this.encryptionType = TYPE1_PREFIXES.some(p => (this.serialNumber ?? '').startsWith(p)) ? 1 : 7;
          break;
        }
      }
    }

    if (model === 'Unknown' && suffix) {
      this.serialNumber = suffix;
    }

    // Use serial override if provided (BLE name is truncated, auth needs full serial)
    if (this.serialOverride) {
      this.log('info', `Using manual serial override: ${this.serialOverride} (BLE name was: ${this.serialNumber})`);
      this.serialNumber = this.serialOverride;
    }

    this.log('info', `Device: ${name}, Model: ${model}, Serial: ${this.serialNumber ?? 'unknown'}, Encryption: Type ${this.encryptionType}`);

    this.handlers.onDeviceInfo({
      serialNumber: this.serialNumber ?? name,
      batteryLevel: -1,
      deviceName: name,
      model,
    });
  }

  // ============================================================
  // BLE characteristic discovery
  // ============================================================
  private async discoverCharacteristics(): Promise<void> {
    if (!this.server) return;

    try {
      const service = await this.server.getPrimaryService('00000001-0000-1000-8000-00805f9b34fb');
      this.log('info', 'Found RFCOMM-style service');
      try { this.writeChar = await service.getCharacteristic(UUID_WRITE); } catch { /* */ }
      try { this.notifyChar = await service.getCharacteristic(UUID_NOTIFY); } catch { /* */ }
      if (this.writeChar && this.notifyChar) return;
    } catch { /* */ }

    try {
      const service = await this.server.getPrimaryService('6e400001-b5a3-f393-e0a9-e50e24dcca9e');
      this.log('info', 'Found Nordic UART service');
      if (!this.writeChar) try { this.writeChar = await service.getCharacteristic(UUID_NUS_WRITE); } catch { /* */ }
      if (!this.notifyChar) try { this.notifyChar = await service.getCharacteristic(UUID_NUS_NOTIFY); } catch { /* */ }
      if (this.writeChar && this.notifyChar) return;
    } catch { /* */ }

    this.log('info', 'Discovering all services...');
    const services = await this.server.getPrimaryServices();
    for (const service of services) {
      const chars = await service.getCharacteristics();
      for (const c of chars) {
        if (!this.writeChar && (c.properties.write || c.properties.writeWithoutResponse)) this.writeChar = c;
        if (!this.notifyChar && c.properties.notify) this.notifyChar = c;
      }
    }
  }

  private async subscribeNotifications(): Promise<void> {
    if (this.notifyChar) {
      this.log('info', 'Subscribing to notifications...');
      await this.notifyChar.startNotifications();
      this.notifyChar.addEventListener('characteristicvaluechanged', this.onNotification.bind(this));
    }
  }

  async disconnect(): Promise<void> {
    this.autoReconnect = false;
    this.stopStatusPolling();
    if (this.server?.connected) this.server.disconnect();
    this.cleanup();
    this.handlers.onStateChange('disconnected');
  }

  private startStatusPolling() {
    this.stopStatusPolling();
    this.statusPollTimer = setInterval(() => {
      if (this.writeChar && this.isAuthenticated) this.requestStatus();
    }, 5000);
  }

  private stopStatusPolling() {
    if (this.statusPollTimer) { clearInterval(this.statusPollTimer); this.statusPollTimer = null; }
  }

  private async attemptReconnect(): Promise<void> {
    if (!this.autoReconnect || !this.device) return;
    this.reconnectCount++;
    if (this.reconnectCount > 3) {
      this.log('error', 'Too many reconnects. Click Connect to retry.');
      this.autoReconnect = false;
      this.handlers.onStateChange('disconnected');
      return;
    }
    this.log('info', `Auto-reconnect (${this.reconnectCount}/3)...`);
    this.handlers.onStateChange('connecting');
    try {
      this.server = await this.device.gatt!.connect();
      await this.discoverCharacteristics();
      this.handlers.onStateChange('negotiating');
      if (this.encryptionType === 1) await this.type1Auth();
      else if (this.encryptionType === 7) await this.type7Auth();
      else {
        await this.subscribeNotifications();
        this.handlers.onStateChange('connected');
        this.startStatusPolling();
      }
    } catch (e) {
      this.log('error', `Reconnect failed: ${e}`);
      setTimeout(() => this.attemptReconnect(), 2000);
    }
  }

  private cleanup() {
    this.sessionKeys = null;
    this.packetBuffer = new Uint8Array(0);
    this.authState = 'idle';
    this.ecdhKeyPair = null;
    this.simpleAssembler = new SimplePacketAssembler();
    this.stopStatusPolling();
  }

  // ============================================================
  // Notification handler
  // ============================================================
  private async onNotification(event: Event): Promise<void> {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    const data = new Uint8Array(target.value!.buffer);
    this.handlers.onRawPacket('rx', data);

    // During Type 7 handshake, route to auth handler
    if (this.authState !== 'idle' && this.authState !== 'authenticated') {
      try {
        const consumed = await this.handleType7AuthData(data);
        if (consumed) return;
      } catch (e) {
        this.log('error', `Auth error: ${e}`);
      }
    }

    // Normal packet processing
    this.packetBuffer = concatBytes(this.packetBuffer, data);
    await this.processBuffer();
  }

  private async processBuffer(): Promise<void> {
    while (this.packetBuffer.length > 0) {
      const type = detectPacketType(this.packetBuffer);

      if (type === 'encrypted') {
        if (this.packetBuffer.length < 6) return;
        const length = this.packetBuffer[4] | (this.packetBuffer[5] << 8);
        const totalLen = 6 + length;
        if (this.packetBuffer.length < totalLen) return;
        const packetData = this.packetBuffer.slice(0, totalLen);
        this.packetBuffer = this.packetBuffer.slice(totalLen);
        await this.handleEncryptedPacket(packetData);
      } else if (type === 'inner') {
        if (this.packetBuffer.length < 5) return;
        const version = this.packetBuffer[1];
        const payloadLen = this.packetBuffer[2] | (this.packetBuffer[3] << 8);
        const innerOverhead = version >= 3 ? 13 : 11;
        // total = header(4) + crc8(1) + innerOverhead + payloadLen + crc16(2)
        const totalLen = 5 + innerOverhead + payloadLen + 2;
        if (this.packetBuffer.length < totalLen) return;
        const packetData = this.packetBuffer.slice(0, totalLen);
        this.packetBuffer = this.packetBuffer.slice(totalLen);
        this.handleInnerPacket(packetData);
      } else {
        this.packetBuffer = this.packetBuffer.slice(1);
      }
    }
  }

  private handleInnerPacket(data: Uint8Array): void {
    const packet = parsePacket(data);
    if (!packet) { this.log('rx', 'Failed to parse', toHex(data).substring(0, 60)); return; }

    const hbType = identifyHeartbeat(packet.src, packet.cmdId);
    this.log('rx',
      `[0xAA] v${packet.version} seq=${packet.seq} ${packet.src.toString(16)}->${packet.dst.toString(16)} ` +
      `cmd=${packet.cmdSet.toString(16).padStart(2, '0')}:${packet.cmdId.toString(16).padStart(2, '0')} ` +
      `(${packet.payload.length}B) [${hbType}]`,
      toHex(packet.payload).substring(0, 80),
    );

    // Reply to received packets to keep the connection alive
    // Python ref: replyPacket() in connection.py — device needs replies to send more data
    if (this.isAuthenticated && this.sessionKeys) {
      this.replyToPacket(packet);
    }

    if (packet.payload.length > 0) {
      try {
        const { data: telemetry, fields } = parseTelemetryDetailed(
          packet.payload, packet.src, packet.cmdSet, packet.cmdId,
        );
        for (const field of fields) {
          const valStr = field.unit ? `${field.value} ${field.unit}` : `${field.value}`;
          this.log('info', `  ${field.name} = ${valStr}`, field.rawHex);
        }
        if (Object.keys(telemetry).length > 0) this.handlers.onTelemetry(telemetry);
      } catch { /* */ }
    }
  }

  // Echo back received packet with src/dst swapped (keeps connection alive)
  private async replyToPacket(packet: ReturnType<typeof parsePacket>): Promise<void> {
    if (!packet || !this.sessionKeys) return;
    // Don't reply to auth packets
    if (packet.cmdSet === 0x35) return;

    const replyPkt = buildPacket(
      packet.dst,    // swap src/dst
      packet.src,
      packet.cmdSet,
      packet.cmdId,
      packet.payload,
      undefined,     // new seq
      packet.version,
      1,             // dsrc
      1,             // ddst
    );
    // Fire-and-forget — don't await to avoid blocking packet processing
    this.sendEncryptedRaw(replyPkt).catch(() => {});
  }

  private async handleEncryptedPacket(data: Uint8Array): Promise<void> {
    const enc = parseEncPacket(data);
    if (!enc) { this.log('rx', 'Failed to parse enc packet', toHex(data).substring(0, 60)); return; }

    this.log('rx', `[0x5A5A] frame=${enc.frameType} encrypted=${enc.encryptedPayload.length}B`);

    if (this.sessionKeys) {
      try {
        const decrypted = await decryptAesCbc(enc.encryptedPayload, this.sessionKeys.aesKey, this.sessionKeys.iv);
        this.log('rx', `Decrypted (${decrypted.length}B)`, toHex(decrypted).substring(0, 80));
        this.handleInnerPacket(decrypted);
      } catch (e) {
        this.log('rx', `Decryption failed: ${e}`);
      }
    } else {
      this.log('info', 'Encrypted packet but no session keys');
    }
  }

  // ============================================================
  // Command sending
  // ============================================================
  async requestStatus(): Promise<void> {
    await this.sendRawCommand(SRC_APP, DST_DEVICE, 0x02, 0x01, new Uint8Array(0));
  }

  // Send UTC time sync — device expects this after auth
  // Python ref: SysUTCSync protobuf with sys_utc_time field
  // Simple protobuf: field 1 (varint) = unix timestamp in seconds
  private async sendTimeSync(): Promise<void> {
    this.log('info', 'Sending RTC time sync...');
    const now = Math.floor(Date.now() / 1000);
    // Encode as protobuf varint: field 1 (tag=0x08), then varint value
    const payload = encodeProtobufVarint(1, now);
    // Python: Packet(0x21, auth_header_dst=0x35, 0x01, 0x52=NET_BLE_COMMAND_CMD_SET_RET_TIME)
    await this.sendRawCommand(0x21, 0x35, 0x01, 0x52, payload);
  }

  private async writeBytes(data: Uint8Array): Promise<void> {
    if (!this.writeChar) return;
    this.handlers.onRawPacket('tx', data);
    try {
      await this.writeChar.writeValueWithoutResponse(data);
    } catch {
      try { await this.writeChar.writeValue(data); } catch (e) { this.log('error', `Write failed: ${e}`); }
    }
  }

  // Write with response — used for encrypted packets (Python: write_with_response=True)
  private async writeBytesWithResponse(data: Uint8Array): Promise<void> {
    if (!this.writeChar) return;
    this.handlers.onRawPacket('tx', data);
    try {
      await this.writeChar.writeValue(data);
    } catch {
      try { await this.writeChar.writeValueWithoutResponse(data); } catch (e) { this.log('error', `Write failed: ${e}`); }
    }
  }

  private async sendEncryptedRaw(innerPacket: Uint8Array): Promise<void> {
    if (!this.sessionKeys) return;
    const encrypted = await encryptAesCbc(innerPacket, this.sessionKeys.aesKey, this.sessionKeys.iv);
    const encPacket = buildEncPacket(FRAME_TYPE_PROTOCOL, encrypted);
    this.log('tx', `[ENC] ${encPacket.length}B`, toHex(encPacket).substring(0, 80));
    // Use write-with-response for encrypted packets (Python: write_with_response=True)
    await this.writeBytesWithResponse(encPacket);
  }

  async sendRawCommand(src: number, dst: number, cmdSet: number, cmdId: number, payload: Uint8Array): Promise<void> {
    if (!this.writeChar) { this.log('error', 'Not connected'); return; }
    const packet = buildPacket(src, dst, cmdSet, cmdId, payload);

    if (this.sessionKeys) {
      await this.sendEncryptedRaw(packet);
    } else {
      this.log('tx', `cmd=${cmdSet.toString(16).padStart(2, '0')}:${cmdId.toString(16).padStart(2, '0')}`, toHex(packet).substring(0, 80));
      await this.writeBytes(packet);
    }
  }

  async sendEncryptedCommand(src: number, dst: number, cmdSet: number, cmdId: number, payload: Uint8Array): Promise<void> {
    if (!this.writeChar || !this.sessionKeys) { this.log('error', 'Not connected or no keys'); return; }
    const inner = buildPacket(src, dst, cmdSet, cmdId, payload);
    await this.sendEncryptedRaw(inner);
  }

  async sendRawBytes(hexData: string): Promise<void> {
    if (!this.writeChar) { this.log('error', 'Not connected'); return; }
    const data = fromHex(hexData);
    this.log('tx', `Raw (${data.length}B)`, hexData);
    await this.writeBytes(data);
  }
}

function findEncPrefix(data: Uint8Array): number {
  for (let i = 0; i < data.length - 1; i++) {
    if (data[i] === 0x5a && data[i + 1] === 0x5a) return i;
  }
  return -1;
}

// Encode a protobuf field (varint type) — field_number + varint value
function encodeProtobufVarint(fieldNumber: number, value: number): Uint8Array {
  const tag = (fieldNumber << 3) | 0; // wire type 0 = varint
  const bytes: number[] = [];
  // Encode tag
  let t = tag;
  while (t > 0x7f) { bytes.push((t & 0x7f) | 0x80); t >>>= 7; }
  bytes.push(t & 0x7f);
  // Encode value
  let v = value;
  while (v > 0x7f) { bytes.push((v & 0x7f) | 0x80); v >>>= 7; }
  bytes.push(v & 0x7f);
  return new Uint8Array(bytes);
}
