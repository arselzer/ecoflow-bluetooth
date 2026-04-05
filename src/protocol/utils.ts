export function toHex(data: Uint8Array | ArrayBuffer): string {
  const arr = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

export function readUint16LE(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

export function readInt16LE(data: Uint8Array, offset: number): number {
  const val = readUint16LE(data, offset);
  return val > 0x7fff ? val - 0x10000 : val;
}

export function readUint32LE(data: Uint8Array, offset: number): number {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

export function writeUint16LE(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >> 8) & 0xff]);
}

export function writeUint32LE(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >> 24) & 0xff,
  ]);
}

// CRC8 (SMBus) - used for packet header validation
const CRC8_TABLE = new Uint8Array(256);
(function initCrc8() {
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) : (crc << 1);
      crc &= 0xff;
    }
    CRC8_TABLE[i] = crc;
  }
})();

export function crc8(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc = CRC8_TABLE[(crc ^ byte) & 0xff];
  }
  return crc;
}

// CRC16-ARC - used for packet payload validation
const CRC16_TABLE = new Uint16Array(256);
(function initCrc16() {
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? ((crc >>> 1) ^ 0xa001) : (crc >>> 1);
    }
    CRC16_TABLE[i] = crc;
  }
})();

export function crc16(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc = (crc >>> 8) ^ CRC16_TABLE[(crc ^ byte) & 0xff];
  }
  return crc & 0xffff;
}
