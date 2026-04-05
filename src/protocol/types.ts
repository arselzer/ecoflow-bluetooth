export interface EcoFlowPacket {
  header: number;
  version: number;
  length: number;
  headerCrc: number;
  seq: number;
  src: number;
  dst: number;
  dsrc: number;
  ddst: number;
  cmdSet: number;
  cmdId: number;
  payload: Uint8Array;
  crc16: number;
  raw: Uint8Array;
}

export interface EncPacket {
  prefix: number;
  frameType: number;
  payloadType: number;
  length: number;
  encryptedPayload: Uint8Array;
  crc16: number;
  raw: Uint8Array;
}

export interface TelemetryData {
  [key: string]: string | number;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'negotiating' | 'connected';

export interface LogEntry {
  timestamp: number;
  direction: 'tx' | 'rx' | 'info' | 'error';
  message: string;
  data?: string;
}

export interface DeviceInfo {
  serialNumber: string;
  batteryLevel: number;
  deviceName: string;
  model: string;
}
