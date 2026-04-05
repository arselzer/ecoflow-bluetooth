// EcoFlow BLE Protocol Constants
// Based on reverse engineering from rabits/ha-ef-ble and community projects

// BLE GATT UUIDs — two transports supported
// RFCOMM-style (primary, used by River 2, Delta 2)
export const UUID_WRITE = '00000002-0000-1000-8000-00805f9b34fb';
export const UUID_NOTIFY = '00000003-0000-1000-8000-00805f9b34fb';
// Nordic UART Service (alternative, some newer devices)
export const UUID_NUS_WRITE = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const UUID_NUS_NOTIFY = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

// Manufacturer ID in BLE advertisements
export const MANUFACTURER_ID = 0xb5b5;

// Packet prefixes
export const PACKET_PREFIX = 0xaa;       // Inner packet header
export const ENC_PACKET_PREFIX = 0x5a5a; // Encrypted outer packet header

// Frame types for EncPacket
export const FRAME_TYPE_COMMAND = 0x00;
export const FRAME_TYPE_PROTOCOL = 0x01;

// Device serial number prefixes (for identification)
// Source: rabits/ha-ef-ble device_mappings.py
export const DEVICE_PREFIXES: Record<string, string> = {
  // River 2 series (protocol v2, Type 1 encryption)
  'R601': 'River 2',
  'R603': 'River 2',
  'R611': 'River 2 Max',
  'R613': 'River 2 Max',
  'R621': 'River 2 Pro',
  'R623': 'River 2 Pro',
  // River 3 series (protocol v2, Type 7 encryption)
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

// BLE advertisement name short-form mapping
// Devices advertise as "EF-XXXYYYYY" where XXX is a short model code
// This maps from BLE name prefix (after "EF-") to model and encryption type
export const BLE_NAME_MAP: Record<string, { model: string; encType: number }> = {
  // River 2 series (Type 1)
  'R2': { model: 'River 2', encType: 1 },
  'R2M': { model: 'River 2 Max', encType: 1 },
  'R2P': { model: 'River 2 Pro', encType: 1 },
  // River 3 series (Type 7)
  'R3': { model: 'River 3', encType: 7 },
  'R3P': { model: 'River 3 Plus', encType: 7 },
  'R3M': { model: 'River 3 Max', encType: 7 },
  // Delta series (Type 1)
  'D2': { model: 'Delta 2', encType: 1 },
  'D2M': { model: 'Delta 2 Max', encType: 1 },
  // Delta 3 series (Type 7)
  'D3': { model: 'Delta 3', encType: 7 },
  'D3P': { model: 'Delta 3 Plus', encType: 7 },
  'DP3': { model: 'Delta Pro 3', encType: 7 },
  // Smart Home Panel (Type 7)
  'HD3': { model: 'Smart Home Panel 2', encType: 7 },
  // Delta Pro Ultra (Type 7)
  'Y7': { model: 'Delta Pro Ultra', encType: 7 },
};

// BLE advertisement name prefixes
export const BLE_NAME_PREFIXES = [
  'EF',       // Common prefix for EcoFlow devices (EF-R2..., EF-HD3...)
];

// Encryption types per device
export const ENCRYPTION_TYPE_1 = 1; // River 2, Delta 2: MD5(serial)
export const ENCRYPTION_TYPE_7 = 7; // River 3, Delta 3, SHP2, DPU: ECDH + login_key.bin

// Devices using Type 1 (simple MD5) encryption
export const TYPE1_PREFIXES = ['R601', 'R603', 'R611', 'R613', 'R621', 'R623', 'DAEB', 'DAEC'];

// Module/source addresses for heartbeat sources
export const SRC_PD = 0x02;    // Power Delivery module
export const SRC_EMS = 0x03;   // Energy Management System
export const SRC_INV = 0x04;   // Inverter module
export const SRC_MPPT = 0x05;  // Solar MPPT controller

// Default destination for commands sent TO the device
export const DST_DEVICE = 0x01;
// Default source for commands sent FROM the app
export const SRC_APP = 0x20;

// ============================================================
// River 2 Commands (src, dst, cmdSet, cmdId, payload format)
// Source: rabits/ha-ef-ble devices/river2.py + tolwi/hassio-ecoflow-cloud
// ============================================================
export interface CommandDef {
  name: string;
  description: string;
  src: number;
  dst: number;
  cmdSet: number;
  cmdId: number;
  payloads?: Record<string, string>; // hex payloads
}

export const RIVER2_COMMANDS: Record<string, CommandDef> = {
  // --- Output Control ---
  'ac_on': {
    name: 'AC Output On',
    description: 'Enable AC inverter output (byte 0=enabled, byte 1=xboost)',
    src: SRC_APP, dst: DST_DEVICE,
    cmdSet: 0x05, cmdId: 0x42,
    payloads: { 'default': '0100' }, // enabled=1, xboost=0
  },
  'ac_off': {
    name: 'AC Output Off',
    description: 'Disable AC inverter output',
    src: SRC_APP, dst: DST_DEVICE,
    cmdSet: 0x05, cmdId: 0x42,
    payloads: { 'default': '0000' }, // enabled=0, xboost=0
  },
  'ac_on_xboost': {
    name: 'AC On + X-Boost',
    description: 'Enable AC output with X-Boost',
    src: SRC_APP, dst: DST_DEVICE,
    cmdSet: 0x05, cmdId: 0x42,
    payloads: { 'default': '0101' }, // enabled=1, xboost=1
  },
  'dc_on': {
    name: 'DC 12V On',
    description: 'Enable DC 12V car port output',
    src: SRC_APP, dst: DST_DEVICE,
    cmdSet: 0x05, cmdId: 0x51,
    payloads: { 'default': '01' },
  },
  'dc_off': {
    name: 'DC 12V Off',
    description: 'Disable DC 12V car port output',
    src: SRC_APP, dst: DST_DEVICE,
    cmdSet: 0x05, cmdId: 0x51,
    payloads: { 'default': '00' },
  },
  // --- Charge Settings ---
  'max_charge_soc_100': {
    name: 'Max Charge 100%',
    description: 'Set maximum charge level to 100%',
    src: SRC_APP, dst: DST_DEVICE,
    cmdSet: 0x03, cmdId: 0x31,
    payloads: { 'default': '64' }, // 100
  },
  'max_charge_soc_80': {
    name: 'Max Charge 80%',
    description: 'Set maximum charge level to 80%',
    src: SRC_APP, dst: DST_DEVICE,
    cmdSet: 0x03, cmdId: 0x31,
    payloads: { 'default': '50' }, // 80
  },
  'min_discharge_soc_0': {
    name: 'Min Discharge 0%',
    description: 'Set minimum discharge level to 0%',
    src: SRC_APP, dst: DST_DEVICE,
    cmdSet: 0x03, cmdId: 0x33,
    payloads: { 'default': '00' },
  },
  // --- Charge Speed ---
  'ac_charge_200w': {
    name: 'AC Charge 200W',
    description: 'Set AC charging speed to 200W',
    src: SRC_APP, dst: DST_DEVICE,
    cmdSet: 0x05, cmdId: 0x45,
    payloads: { 'default': 'c800ff' }, // 200 LE + 0xFF
  },
  'ac_charge_600w': {
    name: 'AC Charge 600W',
    description: 'Set AC charging speed to 600W',
    src: SRC_APP, dst: DST_DEVICE,
    cmdSet: 0x05, cmdId: 0x45,
    payloads: { 'default': '5802ff' }, // 600 LE + 0xFF
  },
  // --- Quiet Mode ---
  'quiet_on': {
    name: 'Quiet Mode On',
    description: 'Enable quiet/silent mode (reduce fan noise)',
    src: SRC_APP, dst: DST_DEVICE,
    cmdSet: 0x05, cmdId: 0x53,
    payloads: { 'default': '01' },
  },
  'quiet_off': {
    name: 'Quiet Mode Off',
    description: 'Disable quiet mode',
    src: SRC_APP, dst: DST_DEVICE,
    cmdSet: 0x05, cmdId: 0x53,
    payloads: { 'default': '00' },
  },
};

// ============================================================
// River 2 Telemetry — Binary struct definitions
// Heartbeat payloads are fixed-length binary structs, NOT protobuf
// Source: rabits/ha-ef-ble devices/river2.py
// ============================================================

export interface StructField {
  name: string;
  offset: number;
  size: 1 | 2 | 4;  // bytes
  signed?: boolean;
  unit?: string;
  divisor?: number;
}

// PD Heartbeat (src=0x02, cmdSet=0x20, cmdId=0x02) ~155 bytes
export const PD_HEARTBEAT_FIELDS: StructField[] = [
  { name: 'soc', offset: 14, size: 1, unit: '%' },
  { name: 'watts_out_sum', offset: 15, size: 2, unit: 'W' },
  { name: 'watts_in_sum', offset: 17, size: 2, unit: 'W' },
  { name: 'remain_time', offset: 19, size: 4, unit: 'min', signed: true },
  { name: 'dc_out_state', offset: 24, size: 1 },
  { name: 'usb1_watts', offset: 25, size: 1, unit: 'W' },
  { name: 'usb2_watts', offset: 26, size: 1, unit: 'W' },
  { name: 'qc1_watts', offset: 27, size: 1, unit: 'W' },
  { name: 'qc2_watts', offset: 28, size: 1, unit: 'W' },
  { name: 'usbc1_watts', offset: 29, size: 1, unit: 'W' },
  { name: 'usbc2_watts', offset: 30, size: 1, unit: 'W' },
];

// EMS Heartbeat (src=0x03, cmdSet=0x20, cmdId=0x02) ~46 bytes
export const EMS_HEARTBEAT_FIELDS: StructField[] = [
  { name: 'chg_state', offset: 0, size: 1 },
  { name: 'max_charge_soc', offset: 12, size: 1, unit: '%' },
  { name: 'lcd_show_soc', offset: 14, size: 1, unit: '%' },
  { name: 'chg_remain_time', offset: 17, size: 4, unit: 'min', signed: true },
  { name: 'dsg_remain_time', offset: 21, size: 4, unit: 'min', signed: true },
  { name: 'min_dsg_soc', offset: 43, size: 1, unit: '%' },
];

// BMS Heartbeat (src=0x03, cmdSet=0x20, cmdId=0x32) ~69 bytes
export const BMS_HEARTBEAT_FIELDS: StructField[] = [
  { name: 'bms_soc', offset: 11, size: 1, unit: '%' },
  { name: 'bms_voltage', offset: 12, size: 4, unit: 'mV' },
  { name: 'bms_current', offset: 16, size: 4, unit: 'mA', signed: true },
  { name: 'bms_temp', offset: 20, size: 1, unit: '\u00b0C' },
  { name: 'bms_cycles', offset: 34, size: 4 },
  { name: 'bms_soh', offset: 38, size: 1, unit: '%' },
];

// Inverter Heartbeat (src=0x04, cmdSet=any, cmdId=0x02)
export const INV_HEARTBEAT_FIELDS: StructField[] = [
  { name: 'inv_input_watts', offset: 9, size: 2, unit: 'W' },
  { name: 'inv_output_watts', offset: 11, size: 2, unit: 'W' },
  { name: 'inv_out_vol', offset: 14, size: 4, unit: 'mV' },
  { name: 'cfg_ac_enabled', offset: 30, size: 1 },
  { name: 'cfg_ac_xboost', offset: 31, size: 1 },
];

// MPPT Heartbeat (src=0x05, cmdSet=0x20, cmdId=0x02) ~80 bytes
export const MPPT_HEARTBEAT_FIELDS: StructField[] = [
  { name: 'mppt_in_vol', offset: 0, size: 2, unit: 'mV' },
  { name: 'mppt_in_amp', offset: 2, size: 2, unit: 'mA' },
  { name: 'mppt_in_watts', offset: 4, size: 2, unit: 'W' },
  { name: 'mppt_out_vol', offset: 6, size: 2, unit: 'mV' },
  { name: 'mppt_out_amp', offset: 8, size: 2, unit: 'mA' },
  { name: 'mppt_out_watts', offset: 10, size: 2, unit: 'W' },
  { name: 'mppt_temp', offset: 12, size: 2, unit: '\u00b0C', signed: true },
  { name: 'dc_in_vol', offset: 36, size: 2, unit: 'mV' },
  { name: 'dc_in_amp', offset: 38, size: 2, unit: 'mA' },
  { name: 'dc_in_watts', offset: 40, size: 2, unit: 'W' },
  { name: 'dc_charge_type', offset: 42, size: 1 },
  { name: 'dc_in_type', offset: 43, size: 1 }, // 0=auto, 1=solar, 2=car
];

// Parameter display labels
export const PARAM_LABELS: Record<string, string> = {
  soc: 'Battery %',
  watts_out_sum: 'Total Output',
  watts_in_sum: 'Total Input',
  remain_time: 'Time Left',
  dc_out_state: 'DC Port',
  usb1_watts: 'USB-A 1',
  usb2_watts: 'USB-A 2',
  qc1_watts: 'QC 1',
  qc2_watts: 'QC 2',
  usbc1_watts: 'USB-C 1',
  usbc2_watts: 'USB-C 2',
  chg_state: 'Charge State',
  max_charge_soc: 'Max Charge',
  lcd_show_soc: 'Display SoC',
  chg_remain_time: 'Charge Time',
  dsg_remain_time: 'Discharge Time',
  min_dsg_soc: 'Min Discharge',
  bms_soc: 'BMS SoC',
  bms_voltage: 'BMS Voltage',
  bms_current: 'BMS Current',
  bms_temp: 'BMS Temp',
  bms_cycles: 'BMS Cycles',
  bms_soh: 'BMS Health',
  inv_input_watts: 'AC Input',
  inv_output_watts: 'AC Output',
  inv_out_vol: 'AC Voltage',
  cfg_ac_enabled: 'AC Enabled',
  cfg_ac_xboost: 'X-Boost',
  mppt_in_vol: 'Solar Voltage In',
  mppt_in_amp: 'Solar Current In',
  mppt_in_watts: 'Solar Power In',
  mppt_out_vol: 'Solar Voltage Out',
  mppt_out_amp: 'Solar Current Out',
  mppt_out_watts: 'Solar Power Out',
  mppt_temp: 'MPPT Temp',
  dc_in_vol: 'DC Input Voltage',
  dc_in_amp: 'DC Input Current',
  dc_in_watts: 'DC Input Power',
  dc_charge_type: 'DC Charge Type',
  dc_in_type: 'DC Input Type',
};

// Parameter groups for display
export const PARAM_GROUPS: Record<string, string[]> = {
  'Battery': ['soc', 'lcd_show_soc', 'remain_time', 'chg_remain_time', 'dsg_remain_time', 'chg_state', 'max_charge_soc', 'min_dsg_soc'],
  'Power I/O': ['watts_out_sum', 'watts_in_sum', 'inv_input_watts', 'inv_output_watts', 'inv_out_vol', 'cfg_ac_enabled', 'cfg_ac_xboost'],
  'USB/DC': ['usb1_watts', 'usb2_watts', 'qc1_watts', 'qc2_watts', 'usbc1_watts', 'usbc2_watts', 'dc_out_state'],
  'BMS': ['bms_soc', 'bms_voltage', 'bms_current', 'bms_temp', 'bms_cycles', 'bms_soh'],
  'Solar/MPPT': ['mppt_in_vol', 'mppt_in_amp', 'mppt_in_watts', 'mppt_out_vol', 'mppt_out_amp', 'mppt_out_watts', 'mppt_temp'],
  'DC Input': ['dc_in_vol', 'dc_in_amp', 'dc_in_watts', 'dc_charge_type', 'dc_in_type'],
};
