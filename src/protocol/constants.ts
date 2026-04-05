// EcoFlow BLE Protocol Constants
// Based on reverse engineering from rabits/ef-ble-reverse and community projects

// BLE GATT UUIDs
// EcoFlow uses standard 16-bit UUIDs expanded to 128-bit
export const UUID_WRITE = '00000002-0000-1000-8000-00805f9b34fb';
export const UUID_NOTIFY = '00000003-0000-1000-8000-00805f9b34fb';

// Manufacturer ID in BLE advertisements
export const MANUFACTURER_ID = 0xb5b5;

// Packet prefixes
export const PACKET_PREFIX = 0xaa;       // Inner packet header
export const ENC_PACKET_PREFIX = 0x5a5a; // Encrypted outer packet header

// Frame types for EncPacket
export const FRAME_TYPE_COMMAND = 0x00;
export const FRAME_TYPE_PROTOCOL = 0x01;

// Payload types
export const PAYLOAD_TYPE_VX = 0x00;
export const PAYLOAD_TYPE_ODM = 0x04;

// Device serial number prefixes (for identification)
export const DEVICE_PREFIXES: Record<string, string> = {
  // River 2 series
  'R331': 'River 2',
  'R332': 'River 2 Max',
  'R333': 'River 2 Pro',
  // River 3 series
  'R651': 'River 3',
  'R653': 'River 3 Plus',
  'R654': 'River 3 Max',
  'R655': 'River 3 Max Plus',
  // Delta series
  'DAEB': 'Delta 2',
  'DAEC': 'Delta 2 Max',
  'P331': 'Delta 3',
  'P351': 'Delta 3 Plus',
  'MR51': 'Delta Pro 3',
  // Smart Home Panel
  'HD31': 'Smart Home Panel 2',
  // Delta Pro Ultra
  'Y711': 'Delta Pro Ultra',
};

// BLE advertisement name prefixes
export const BLE_NAME_PREFIXES = [
  'EF-',      // Common prefix for EcoFlow devices
  'HD3',      // Smart Home Panel 2
  'Y7',       // Delta Pro Ultra
  'R33',      // River 2 series
  'R6',       // River 3 series
  'P3',       // Delta 3 series
  'MR5',      // Delta Pro 3
  'DAEB',     // Delta 2
];

// Command sets
export const CMD_SET_AUTH = 0x35;
export const CMD_SET_SYSTEM = 0x01;
export const CMD_SET_PD = 0x02;
export const CMD_SET_BMS = 0x02;
export const CMD_SET_INV = 0x04;
export const CMD_SET_MPPT = 0x05;
export const CMD_SET_TIME = 0x0c;

// Command IDs
export const CMD_ID_AUTH_REQUEST = 0x86;
export const CMD_ID_AUTH_RESPONSE = 0x89;
export const CMD_ID_RTC_SYNC = 0x52;
export const CMD_ID_HEARTBEAT = 0x01;

// Known command sets & IDs for River 2 / portable power stations
// These are common across Delta/River series
export const KNOWN_COMMANDS: Record<string, { name: string; description: string; cmdSet: number; cmdId: number; payloads?: Record<string, string> }> = {
  'pd_heartbeat': {
    name: 'PD Heartbeat',
    description: 'Request power delivery status (battery, input/output power)',
    cmdSet: 0x02,
    cmdId: 0x01,
  },
  'bms_heartbeat': {
    name: 'BMS Heartbeat',
    description: 'Battery management system status',
    cmdSet: 0x02,
    cmdId: 0x02,
  },
  'inv_heartbeat': {
    name: 'INV Heartbeat',
    description: 'Inverter status (AC output)',
    cmdSet: 0x04,
    cmdId: 0x01,
  },
  'mppt_heartbeat': {
    name: 'MPPT Heartbeat',
    description: 'Solar charge controller status',
    cmdSet: 0x05,
    cmdId: 0x01,
  },
  'ac_on': {
    name: 'AC Output On',
    description: 'Enable AC inverter output',
    cmdSet: 0x04,
    cmdId: 0x31,
    payloads: { 'default': '01' },
  },
  'ac_off': {
    name: 'AC Output Off',
    description: 'Disable AC inverter output',
    cmdSet: 0x04,
    cmdId: 0x31,
    payloads: { 'default': '00' },
  },
  'dc_on': {
    name: 'DC Output On',
    description: 'Enable DC (USB/12V) output',
    cmdSet: 0x02,
    cmdId: 0x31,
    payloads: { 'default': '01' },
  },
  'dc_off': {
    name: 'DC Output Off',
    description: 'Disable DC (USB/12V) output',
    cmdSet: 0x02,
    cmdId: 0x31,
    payloads: { 'default': '00' },
  },
};

// Telemetry parameter names for PD heartbeat (River 2 / Delta 2)
export type ParamDef = {
  name: string;
  unit?: string;
  divisor?: number;
  signed?: boolean;
};

// River 2 series PD (Power Delivery) heartbeat fields
// Protobuf field numbers from reverse-engineered .proto files
export const RIVER2_PD_PARAMS: Record<number, ParamDef> = {
  1: { name: 'sys_watts', unit: 'W' },
  2: { name: 'sys_ver' },
  3: { name: 'remain_time', unit: 'min' },
  4: { name: 'ac_auto_off_sec', unit: 's' },
  5: { name: 'soc', unit: '%' },                    // Battery percentage
  6: { name: 'watts_out_sum', unit: 'W' },           // Total output power
  7: { name: 'watts_in_sum', unit: 'W' },            // Total input power
  8: { name: 'usb1_watts', unit: 'W' },
  9: { name: 'usb2_watts', unit: 'W' },
  10: { name: 'usbc1_watts', unit: 'W' },
  11: { name: 'usbc2_watts', unit: 'W' },
  12: { name: 'car_watts', unit: 'W' },              // 12V car port
  13: { name: 'ac_watts', unit: 'W' },               // AC output
  14: { name: 'ac_in_watts', unit: 'W' },            // AC input (charging)
  15: { name: 'mppt_watts', unit: 'W' },             // Solar input
  16: { name: 'remain_cap', unit: 'Wh' },            // Remaining capacity
  17: { name: 'full_cap', unit: 'Wh' },              // Full capacity
  18: { name: 'temperature', unit: '\u00b0C', divisor: 10 },
  19: { name: 'cycles' },                            // Battery cycles
  20: { name: 'soh', unit: '%' },                    // State of health
};

// BMS heartbeat fields
export const RIVER2_BMS_PARAMS: Record<number, ParamDef> = {
  1: { name: 'bms_soc', unit: '%' },
  2: { name: 'bms_voltage', unit: 'mV' },
  3: { name: 'bms_current', unit: 'mA', signed: true },
  4: { name: 'bms_temp', unit: '\u00b0C', divisor: 10 },
  5: { name: 'bms_remain_cap', unit: 'mAh' },
  6: { name: 'bms_full_cap', unit: 'mAh' },
  7: { name: 'bms_cycles' },
  8: { name: 'bms_soh', unit: '%' },
  9: { name: 'cell_vol_max', unit: 'mV' },
  10: { name: 'cell_vol_min', unit: 'mV' },
};

// Inverter heartbeat fields
export const RIVER2_INV_PARAMS: Record<number, ParamDef> = {
  1: { name: 'inv_ac_voltage', unit: 'V', divisor: 10 },
  2: { name: 'inv_ac_current', unit: 'A', divisor: 1000 },
  3: { name: 'inv_ac_watts', unit: 'W' },
  4: { name: 'inv_frequency', unit: 'Hz', divisor: 10 },
  5: { name: 'inv_temperature', unit: '\u00b0C', divisor: 10 },
  6: { name: 'inv_dc_voltage', unit: 'V', divisor: 10 },
  7: { name: 'inv_enabled' },                        // 0=off, 1=on
  8: { name: 'inv_type' },                           // AC output type
};

// MPPT (Solar) heartbeat fields
export const RIVER2_MPPT_PARAMS: Record<number, ParamDef> = {
  1: { name: 'mppt_voltage', unit: 'V', divisor: 10 },
  2: { name: 'mppt_current', unit: 'A', divisor: 100 },
  3: { name: 'mppt_watts', unit: 'W' },
  4: { name: 'mppt_temperature', unit: '\u00b0C', divisor: 10 },
};

// Parameter display labels
export const PARAM_LABELS: Record<string, string> = {
  soc: 'Battery %',
  watts_out_sum: 'Total Output',
  watts_in_sum: 'Total Input',
  ac_watts: 'AC Output',
  ac_in_watts: 'AC Input',
  mppt_watts: 'Solar Input',
  usb1_watts: 'USB-A 1',
  usb2_watts: 'USB-A 2',
  usbc1_watts: 'USB-C 1',
  usbc2_watts: 'USB-C 2',
  car_watts: '12V Car Port',
  remain_cap: 'Remaining',
  full_cap: 'Full Capacity',
  temperature: 'Temperature',
  remain_time: 'Time Left',
  cycles: 'Battery Cycles',
  soh: 'Health',
  sys_watts: 'System Power',
  bms_soc: 'BMS SoC',
  bms_voltage: 'BMS Voltage',
  bms_current: 'BMS Current',
  bms_temp: 'BMS Temp',
  bms_remain_cap: 'BMS Remaining',
  bms_full_cap: 'BMS Full Cap',
  bms_cycles: 'BMS Cycles',
  bms_soh: 'BMS Health',
  cell_vol_max: 'Cell Max V',
  cell_vol_min: 'Cell Min V',
  inv_ac_voltage: 'AC Voltage',
  inv_ac_current: 'AC Current',
  inv_ac_watts: 'AC Power',
  inv_frequency: 'AC Frequency',
  inv_temperature: 'Inverter Temp',
  inv_dc_voltage: 'DC Input V',
  inv_enabled: 'Inverter On',
  mppt_voltage: 'Solar Voltage',
  mppt_current: 'Solar Current',
  mppt_temperature: 'MPPT Temp',
};

// Parameter groups for display
export const PARAM_GROUPS: Record<string, string[]> = {
  'Battery': ['soc', 'remain_cap', 'full_cap', 'temperature', 'cycles', 'soh', 'remain_time', 'sys_watts'],
  'Power I/O': ['watts_out_sum', 'watts_in_sum', 'ac_watts', 'ac_in_watts', 'mppt_watts'],
  'USB/DC': ['usb1_watts', 'usb2_watts', 'usbc1_watts', 'usbc2_watts', 'car_watts'],
  'BMS': ['bms_soc', 'bms_voltage', 'bms_current', 'bms_temp', 'bms_remain_cap', 'bms_full_cap', 'bms_cycles', 'bms_soh', 'cell_vol_max', 'cell_vol_min'],
  'Inverter': ['inv_ac_voltage', 'inv_ac_current', 'inv_ac_watts', 'inv_frequency', 'inv_temperature', 'inv_dc_voltage', 'inv_enabled', 'inv_type'],
  'Solar': ['mppt_voltage', 'mppt_current', 'mppt_temperature'],
};
