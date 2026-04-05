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

// River 3 protobuf field mapping (cmd=fe:15)
// Discovered via live device capture from River 3 Plus
const RIVER3_PROTO_FIELDS: Record<number, { name: string; unit?: string; type?: 'float' }> = {
  1: { name: 'sys_status' },
  8: { name: 'soc', unit: '%' },
  17: { name: 'full_cap_mins', unit: 'min' },
  18: { name: 'remain_mins_1', unit: 'min' },
  19: { name: 'remain_mins_2', unit: 'min' },
  22: { name: 'watts_out_sum', unit: 'W' },
  23: { name: 'output_count' },
  25: { name: 'ac_enabled' },
  37: { name: 'watts_in_sum', unit: 'W' },
  158: { name: 'power_factor', type: 'float' },
  195: { name: 'dc_enabled' },
  211: { name: 'lcd_soc', unit: '%' },
  212: { name: 'charge_watts', unit: 'W' },
  227: { name: 'bms_cycles' },
  242: { name: 'temperature', unit: '\u00b0C', type: 'float' },
  243: { name: 'max_charge_soc', type: 'float' },
  248: { name: 'full_cap_wh', unit: 'Wh' },
  254: { name: 'total_out_kwh' },
  255: { name: 'total_in_kwh' },
  258: { name: 'temp_sensor_1', unit: '\u00b0C' },
  259: { name: 'temp_sensor_2', unit: '\u00b0C' },
  260: { name: 'temp_sensor_3', unit: '\u00b0C' },
  261: { name: 'temp_sensor_4', unit: '\u00b0C' },
  262: { name: 'inv_temperature', unit: '\u00b0C', type: 'float' },
  263: { name: 'bms_soh', type: 'float' },
  268: { name: 'total_out_kwh_2' },
  269: { name: 'total_in_kwh_2' },
  270: { name: 'charge_limit', unit: '%' },
  271: { name: 'discharge_limit', unit: '%' },
  359: { name: 'solar_watts', unit: 'W' },
};

// Parse protobuf telemetry (River 3 fe:15 packets)
function parseProtobufTelemetry(payload: Uint8Array): { data: TelemetryData; fields: ParsedField[] } {
  const telemetry: TelemetryData = {};
  const parsed: ParsedField[] = [];
  let offset = 0;

  while (offset < payload.length) {
    const startOff = offset;
    // Decode tag
    let tag = 0, shift = 0;
    while (offset < payload.length) {
      const b = payload[offset++];
      tag |= (b & 0x7f) << shift;
      shift += 7;
      if (!(b & 0x80)) break;
    }
    const fieldNum = tag >>> 3;
    const wireType = tag & 7;

    if (wireType === 0) { // varint
      let val = 0; shift = 0;
      while (offset < payload.length) {
        const b = payload[offset++];
        val |= (b & 0x7f) << shift;
        shift += 7;
        if (!(b & 0x80)) break;
      }
      const def = RIVER3_PROTO_FIELDS[fieldNum];
      if (def) {
        telemetry[def.name] = val;
        parsed.push({ name: def.name, offset: startOff, size: offset - startOff, rawHex: toHex(payload.slice(startOff, offset)), value: val, unit: def.unit });
      }
    } else if (wireType === 5) { // 32-bit
      if (offset + 4 > payload.length) break;
      const view = new DataView(payload.buffer, payload.byteOffset + offset, 4);
      const fv = view.getFloat32(0, true);
      const uv = view.getUint32(0, true);
      offset += 4;
      const def = RIVER3_PROTO_FIELDS[fieldNum];
      if (def) {
        const val = def.type === 'float' ? Math.round(fv * 100) / 100 : uv;
        telemetry[def.name] = val;
        parsed.push({ name: def.name, offset: startOff, size: offset - startOff, rawHex: toHex(payload.slice(startOff, offset)), value: val, unit: def.unit });
      }
    } else if (wireType === 2) { // length-delimited - skip
      let len = 0; shift = 0;
      while (offset < payload.length) {
        const b = payload[offset++];
        len |= (b & 0x7f) << shift;
        shift += 7;
        if (!(b & 0x80)) break;
      }
      offset += len;
    } else if (wireType === 1) { // 64-bit - skip
      offset += 8;
    } else {
      break;
    }
  }

  return { data: telemetry, fields: parsed };
}

// Parse telemetry from a decoded inner packet
export function parseTelemetryDetailed(
  payload: Uint8Array,
  src: number,
  cmdSet: number,
  cmdId: number,
): { data: TelemetryData; fields: ParsedField[] } {
  // River 3 protobuf telemetry (cmd=fe:15)
  if (cmdSet === 0xfe && cmdId === 0x15) {
    return parseProtobufTelemetry(payload);
  }

  const structFields = selectFields(src, cmdSet, cmdId);

  if (!structFields) {
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
