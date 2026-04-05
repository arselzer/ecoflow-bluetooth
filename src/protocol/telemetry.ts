import {
  PD_HEARTBEAT_FIELDS, EMS_HEARTBEAT_FIELDS, BMS_HEARTBEAT_FIELDS,
  INV_HEARTBEAT_FIELDS, MPPT_HEARTBEAT_FIELDS,
  PARAM_LABELS, PARAM_GROUPS,
  SRC_PD, SRC_EMS, SRC_INV, SRC_MPPT,
} from './constants';
import type { StructField } from './constants';
import type { TelemetryData } from './types';
import { toHex } from './utils';

export interface ParsedField {
  name: string;
  offset: number;
  size: number;
  rawHex: string;
  value: number;
  unit?: string;
}

// Parse a binary struct payload into named fields
function parseStruct(data: Uint8Array, fields: StructField[]): { telemetry: TelemetryData; parsed: ParsedField[] } {
  const telemetry: TelemetryData = {};
  const parsed: ParsedField[] = [];

  for (const field of fields) {
    if (field.offset + field.size > data.length) continue;

    const rawBytes = data.slice(field.offset, field.offset + field.size);
    let value: number;

    switch (field.size) {
      case 1:
        value = field.signed
          ? (data[field.offset] > 127 ? data[field.offset] - 256 : data[field.offset])
          : data[field.offset];
        break;
      case 2: {
        const raw = data[field.offset] | (data[field.offset + 1] << 8);
        value = field.signed
          ? (raw > 0x7fff ? raw - 0x10000 : raw)
          : raw;
        break;
      }
      case 4: {
        const raw = (data[field.offset] | (data[field.offset + 1] << 8) |
          (data[field.offset + 2] << 16) | (data[field.offset + 3] << 24));
        value = field.signed ? raw : raw >>> 0;
        break;
      }
      default:
        continue;
    }

    if (field.divisor) {
      value = Math.round((value / field.divisor) * 10) / 10;
    }

    telemetry[field.name] = value;
    parsed.push({
      name: field.name,
      offset: field.offset,
      size: field.size,
      rawHex: toHex(rawBytes),
      value,
      unit: field.unit,
    });
  }

  return { telemetry, parsed };
}

// Select the correct struct fields based on packet source/cmdSet/cmdId
function selectFields(src: number, _cmdSet: number, cmdId: number): StructField[] | null {
  // PD Heartbeat: src=0x02, cmdSet=0x20, cmdId=0x02
  if (src === SRC_PD && cmdId === 0x02) return PD_HEARTBEAT_FIELDS;

  // EMS Heartbeat: src=0x03, cmdSet=0x20, cmdId=0x02
  if (src === SRC_EMS && cmdId === 0x02) return EMS_HEARTBEAT_FIELDS;

  // BMS Heartbeat: src=0x03, cmdSet=0x20, cmdId=0x32
  if (src === SRC_EMS && cmdId === 0x32) return BMS_HEARTBEAT_FIELDS;

  // Inverter Heartbeat: src=0x04, cmdId=0x02
  if (src === SRC_INV && cmdId === 0x02) return INV_HEARTBEAT_FIELDS;

  // MPPT Heartbeat: src=0x05, cmdSet=0x20, cmdId=0x02
  if (src === SRC_MPPT && cmdId === 0x02) return MPPT_HEARTBEAT_FIELDS;

  return null;
}

// Parse telemetry from a decoded inner packet
export function parseTelemetryDetailed(
  payload: Uint8Array,
  src: number,
  cmdSet: number,
  cmdId: number,
): { data: TelemetryData; fields: ParsedField[] } {
  const structFields = selectFields(src, cmdSet, cmdId);

  if (!structFields) {
    // Unknown message type — return raw hex dump
    return {
      data: {},
      fields: [{
        name: `raw_${src.toString(16)}_${cmdSet.toString(16)}_${cmdId.toString(16)}`,
        offset: 0,
        size: payload.length,
        rawHex: toHex(payload),
        value: payload.length,
        unit: 'bytes',
      }],
    };
  }

  const { telemetry, parsed } = parseStruct(payload, structFields);
  return { data: telemetry, fields: parsed };
}

// Convenience wrapper
export function parseTelemetry(payload: Uint8Array, src: number, cmdSet: number, cmdId: number): TelemetryData {
  return parseTelemetryDetailed(payload, src, cmdSet, cmdId).data;
}

// Parse manufacturer data from BLE advertisement
// Format: [flags] serial_number(16 bytes) battery_level(1 byte) ...
export function parseManufacturerData(data: DataView): { serialNumber: string; batteryLevel: number } | null {
  if (data.byteLength < 18) return null;

  // Serial number is at bytes 1-17 (16 chars, ASCII)
  const serialBytes = new Uint8Array(data.buffer, data.byteOffset + 1, 16);
  const serialNumber = new TextDecoder().decode(serialBytes).replace(/\0/g, '');

  // Battery level follows serial
  const batteryLevel = data.byteLength > 17 ? data.getUint8(17) : -1;

  return { serialNumber, batteryLevel };
}

// Identify heartbeat type for display
export function identifyHeartbeat(src: number, cmdId: number): string {
  if (src === SRC_PD && cmdId === 0x02) return 'PD Heartbeat';
  if (src === SRC_EMS && cmdId === 0x02) return 'EMS Heartbeat';
  if (src === SRC_EMS && cmdId === 0x32) return 'BMS Heartbeat';
  if (src === SRC_INV && cmdId === 0x02) return 'Inverter Heartbeat';
  if (src === SRC_MPPT && cmdId === 0x02) return 'MPPT Heartbeat';
  return `Unknown (src=0x${src.toString(16)}, cmd=0x${cmdId.toString(16)})`;
}

// Re-export display helpers
export { PARAM_LABELS, PARAM_GROUPS };
