import { RIVER2_PD_PARAMS, RIVER2_BMS_PARAMS, RIVER2_INV_PARAMS, RIVER2_MPPT_PARAMS, PARAM_LABELS, PARAM_GROUPS } from './constants';
import type { ParamDef } from './constants';
import type { TelemetryData } from './types';
import { toHex } from './utils';

export interface TlvEntry {
  offset: number;
  fieldNumber: number;
  wireType: number;
  name: string | null;
  rawHex: string;
  decoded: string | number | null;
  unit?: string;
}

// Simple protobuf varint decoder
function decodeVarint(data: Uint8Array, offset: number): { value: number; bytesRead: number } {
  let result = 0;
  let shift = 0;
  let bytesRead = 0;

  while (offset + bytesRead < data.length) {
    const byte = data[offset + bytesRead];
    result |= (byte & 0x7f) << shift;
    bytesRead++;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }

  return { value: result >>> 0, bytesRead };
}

// Parse protobuf-encoded telemetry data
// EcoFlow uses protobuf for encoding heartbeat messages
export function parseTelemetryDetailed(
  data: Uint8Array,
  cmdSet: number,
  cmdId: number,
): { data: TelemetryData; tlvEntries: TlvEntry[] } {
  const telemetry: TelemetryData = {};
  const entries: TlvEntry[] = [];

  // Select param map based on command set/id
  let paramMap: Record<number, ParamDef>;
  if (cmdSet === 0x02 && cmdId === 0x01) {
    paramMap = RIVER2_PD_PARAMS;
  } else if (cmdSet === 0x02 && cmdId === 0x02) {
    paramMap = RIVER2_BMS_PARAMS;
  } else if (cmdSet === 0x04 && cmdId === 0x01) {
    paramMap = RIVER2_INV_PARAMS;
  } else if (cmdSet === 0x05 && cmdId === 0x01) {
    paramMap = RIVER2_MPPT_PARAMS;
  } else {
    paramMap = RIVER2_PD_PARAMS; // default
  }

  let offset = 0;
  while (offset < data.length) {
    // Read protobuf tag (field_number << 3 | wire_type)
    const { value: tag, bytesRead: tagBytes } = decodeVarint(data, offset);
    if (tagBytes === 0) break;

    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;
    const entryOffset = offset;

    offset += tagBytes;

    let rawBytes: Uint8Array;
    let decoded: string | number | null = null;

    switch (wireType) {
      case 0: { // Varint
        const { value, bytesRead } = decodeVarint(data, offset);
        rawBytes = data.slice(entryOffset, offset + bytesRead);
        decoded = value;
        offset += bytesRead;
        break;
      }
      case 1: { // 64-bit fixed
        rawBytes = data.slice(entryOffset, offset + 8);
        if (offset + 8 <= data.length) {
          // Read as double
          const view = new DataView(data.buffer, data.byteOffset + offset, 8);
          decoded = view.getFloat64(0, true);
        }
        offset += 8;
        break;
      }
      case 2: { // Length-delimited
        const { value: len, bytesRead } = decodeVarint(data, offset);
        offset += bytesRead;
        rawBytes = data.slice(entryOffset, offset + len);
        if (offset + len <= data.length) {
          const fieldData = data.slice(offset, offset + len);
          // Try to decode as string
          const ascii = new TextDecoder().decode(fieldData);
          if (/^[\x20-\x7e]+$/.test(ascii)) {
            decoded = ascii;
          } else {
            decoded = toHex(fieldData);
          }
        }
        offset += len;
        break;
      }
      case 5: { // 32-bit fixed
        rawBytes = data.slice(entryOffset, offset + 4);
        if (offset + 4 <= data.length) {
          const view = new DataView(data.buffer, data.byteOffset + offset, 4);
          // Try as float first, then as uint32
          const floatVal = view.getFloat32(0, true);
          const uint32Val = view.getUint32(0, true);
          decoded = (Math.abs(floatVal) < 1e6 && Math.abs(floatVal) > 1e-6) ? Math.round(floatVal * 100) / 100 : uint32Val;
        }
        offset += 4;
        break;
      }
      default: {
        // Unknown wire type - stop parsing
        rawBytes = data.slice(entryOffset);
        offset = data.length;
        break;
      }
    }

    const param = paramMap[fieldNumber];
    let name = param?.name ?? null;
    let value = decoded;

    if (param && typeof value === 'number') {
      if (param.divisor) {
        value = Math.round((value / param.divisor) * 10) / 10;
      }
      if (param.signed && value > 0x7fffffff) {
        value = value - 0x100000000;
      }
    }

    if (name && value !== null) {
      telemetry[name] = value;
    }

    entries.push({
      offset: entryOffset,
      fieldNumber,
      wireType,
      name,
      rawHex: toHex(rawBytes!),
      decoded: value,
      unit: param?.unit,
    });
  }

  return { data: telemetry, tlvEntries: entries };
}

// Convenience wrapper
export function parseTelemetry(data: Uint8Array, cmdSet: number, cmdId: number): TelemetryData {
  return parseTelemetryDetailed(data, cmdSet, cmdId).data;
}

// Parse manufacturer data from BLE advertisement
// Format: [flags...] serial_number(16 bytes) battery_level(1 byte) ...
export function parseManufacturerData(data: DataView): { serialNumber: string; batteryLevel: number } | null {
  if (data.byteLength < 18) return null;

  // Serial number is at bytes 1-17 (16 chars)
  const serialBytes = new Uint8Array(data.buffer, data.byteOffset + 1, 16);
  const serialNumber = new TextDecoder().decode(serialBytes).replace(/\0/g, '');

  // Battery level follows
  const batteryLevel = data.byteLength > 17 ? data.getUint8(17) : -1;

  return { serialNumber, batteryLevel };
}

// Re-export display helpers
export { PARAM_LABELS, PARAM_GROUPS };
