import { PACKET_PREFIX, ENC_PACKET_PREFIX } from './constants';
import { crc8, crc16, toHex, readUint16LE, readUint32LE, writeUint16LE, writeUint32LE, concatBytes } from './utils';
import type { EcoFlowPacket, EncPacket } from './types';

// Sequence counter for outgoing packets
let sequenceCounter = 1;

export function nextSequence(): number {
  return sequenceCounter++;
}

// Build an inner EcoFlow packet (0xAA prefix)
// Python ref: Packet.toBytes() in rabits/ha-ef-ble
//
// Header: [0xAA][version][payload_length_LE][CRC8_of_header]
// Body:   [product_byte][seq_4B_LE][0x00][0x00][src][dst]
//         [dsrc][ddst]  <-- only in v3+
//         [cmdSet][cmdId][payload]
// Footer: [CRC16_of_entire_packet_LE]
//
// IMPORTANT: payload_length = len(payload), NOT len(body)
export function buildPacket(
  src: number,
  dst: number,
  cmdSet: number,
  cmdId: number,
  payload: Uint8Array,
  seq?: number,
  version: number = 3,
  dsrc: number = 1,
  ddst: number = 1,
): Uint8Array {
  const seqNum = seq ?? nextSequence();
  const productByte = 0x0d; // product_id >= 0

  // Header: 0xAA + version + payload_length(2 LE)
  // payload_length = len(command payload), matching Python's struct.pack("<H", len(self._payload))
  const header = new Uint8Array([
    PACKET_PREFIX,
    version,
    payload.length & 0xff,
    (payload.length >> 8) & 0xff,
  ]);
  const headerCrcVal = crc8(header);

  // Build body after header+crc8
  let body: Uint8Array;
  if (version >= 3) {
    body = concatBytes(
      new Uint8Array([productByte]),
      writeUint32LE(seqNum),
      new Uint8Array([0x00, 0x00]),  // reserved
      new Uint8Array([src, dst]),
      new Uint8Array([dsrc, ddst]),  // v3+ fields
      new Uint8Array([cmdSet, cmdId]),
      payload,
    );
  } else {
    body = concatBytes(
      new Uint8Array([productByte]),
      writeUint32LE(seqNum),
      new Uint8Array([0x00, 0x00]),  // reserved
      new Uint8Array([src, dst]),
      new Uint8Array([cmdSet, cmdId]),
      payload,
    );
  }

  // Full data = header + crc8 + body
  const withoutCrc16 = concatBytes(header, new Uint8Array([headerCrcVal]), body);

  // CRC16 over everything so far
  const crc16Val = crc16(withoutCrc16);

  return concatBytes(withoutCrc16, writeUint16LE(crc16Val));
}

// Build an encrypted outer packet (0x5A5A prefix)
export function buildEncPacket(
  frameType: number,
  encryptedPayload: Uint8Array,
): Uint8Array {
  // Header: [0x5A5A][frame_type<<4 | flags][0x01][length_LE]
  const length = encryptedPayload.length + 2; // payload + CRC16
  const header = concatBytes(
    new Uint8Array([0x5a, 0x5a]),
    new Uint8Array([(frameType << 4) & 0xf0]),
    new Uint8Array([0x01]),
    writeUint16LE(length),
  );

  // CRC16 covers header + payload (matches Python: crc16(data) before appending crc)
  const headerPlusPayload = concatBytes(header, encryptedPayload);
  const payloadCrc = crc16(headerPlusPayload);
  return concatBytes(headerPlusPayload, writeUint16LE(payloadCrc));
}

// Parse an inner packet (0xAA prefix)
// Python ref: Packet.fromBytes() in rabits/ha-ef-ble
// Header: [0xAA][version][payload_length_LE][CRC8]
// payload_length = length of just the command payload
export function parsePacket(data: Uint8Array): EcoFlowPacket | null {
  if (data.length < 10) return null;
  if (data[0] !== PACKET_PREFIX) return null;

  const version = data[1];
  const payloadLength = readUint16LE(data, 2);
  const headerCrcVal = data[4];

  // Verify header CRC8
  const computedHeaderCrc = crc8(data.slice(0, 4));
  if (computedHeaderCrc !== headerCrcVal) {
    console.warn('[Packet] Header CRC8 mismatch:', headerCrcVal.toString(16), 'vs', computedHeaderCrc.toString(16));
  }

  // Determine inner overhead based on version
  // v2: product(1) + seq(4) + reserved(2) + src(1) + dst(1) + cmdSet(1) + cmdId(1) = 11
  // v3+: product(1) + seq(4) + reserved(2) + src(1) + dst(1) + dsrc(1) + ddst(1) + cmdSet(1) + cmdId(1) = 13
  const innerOverhead = version >= 3 ? 13 : 11;

  // Total packet = header(4) + crc8(1) + innerOverhead + payloadLength + crc16(2)
  const totalLen = 5 + innerOverhead + payloadLength + 2;
  if (data.length < totalLen) return null;

  // Parse fields after header+crc8
  const bodyStart = 5;
  // body[0] = product_byte
  const seq = readUint32LE(data, bodyStart + 1);
  // bodyStart+5, bodyStart+6 = reserved
  const src = data[bodyStart + 7];
  const dst = data[bodyStart + 8];

  let dsrc: number, ddst: number, cmdSet: number, cmdId: number;
  let payloadStart: number;

  if (version >= 3) {
    dsrc = data[bodyStart + 9];
    ddst = data[bodyStart + 10];
    cmdSet = data[bodyStart + 11];
    cmdId = data[bodyStart + 12];
    payloadStart = bodyStart + 13;
  } else {
    dsrc = 0;
    ddst = 0;
    cmdSet = data[bodyStart + 9];
    cmdId = data[bodyStart + 10];
    payloadStart = bodyStart + 11;
  }

  let payload = data.slice(payloadStart, payloadStart + payloadLength);

  // Undo XOR obfuscation
  const seqByte0 = seq & 0xff;
  if (seqByte0 !== 0 && payload.length > 0) {
    payload = new Uint8Array(payload);
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= seqByte0;
    }
  }

  // CRC16 at end — covers everything before it
  const crc16Offset = payloadStart + payloadLength;
  const crc16Val = readUint16LE(data, crc16Offset);
  const computedCrc16 = crc16(data.slice(0, crc16Offset));
  if (computedCrc16 !== crc16Val) {
    console.warn('[Packet] CRC16 mismatch:', crc16Val.toString(16), 'vs', computedCrc16.toString(16));
  }

  return {
    header: PACKET_PREFIX,
    version,
    length: payloadLength,
    headerCrc: headerCrcVal,
    seq,
    src,
    dst,
    dsrc,
    ddst,
    cmdSet,
    cmdId,
    payload,
    crc16: crc16Val,
    raw: data,
  };
}

// Parse an encrypted outer packet (0x5A5A prefix)
export function parseEncPacket(data: Uint8Array): EncPacket | null {
  if (data.length < 8) return null;

  if (data[0] !== 0x5a || data[1] !== 0x5a) return null;

  const frameType = (data[2] >> 4) & 0x0f;
  const payloadType = data[3];
  const length = readUint16LE(data, 4);

  // Length includes payload + CRC16
  const encPayloadLen = length - 2;
  if (encPayloadLen < 0 || data.length < 6 + length) return null;

  const encryptedPayload = data.slice(6, 6 + encPayloadLen);
  const crc16Val = readUint16LE(data, 6 + encPayloadLen);

  return {
    prefix: ENC_PACKET_PREFIX,
    frameType,
    payloadType,
    length,
    encryptedPayload,
    crc16: crc16Val,
    raw: data,
  };
}

// Detect packet type from first bytes
export function detectPacketType(data: Uint8Array): 'inner' | 'encrypted' | 'unknown' {
  if (data.length < 2) return 'unknown';
  if (data[0] === PACKET_PREFIX) return 'inner';
  if (data[0] === 0x5a && data[1] === 0x5a) return 'encrypted';
  return 'unknown';
}

// Format packet for display
export function formatPacket(data: Uint8Array): string {
  const type = detectPacketType(data);
  if (type === 'inner') {
    const pkt = parsePacket(data);
    if (pkt) {
      return `[0xAA] v${pkt.version} seq=${pkt.seq} ${pkt.src.toString(16)}->${pkt.dst.toString(16)} cmd=${pkt.cmdSet.toString(16).padStart(2, '0')}:${pkt.cmdId.toString(16).padStart(2, '0')} payload=${pkt.payload.length}B`;
    }
  } else if (type === 'encrypted') {
    const enc = parseEncPacket(data);
    if (enc) {
      return `[0x5A5A] frame=${enc.frameType} encrypted=${enc.encryptedPayload.length}B`;
    }
  }
  return `[???] ${toHex(data).substring(0, 40)}...`;
}

// ============================================================
// SimplePacketAssembler — for unencrypted EncPacket handshake frames
// Used during ECDH key exchange (before encryption is established)
// ============================================================

export class SimplePacketAssembler {
  private buffer: Uint8Array = new Uint8Array(0);

  // Wrap raw payload in an unencrypted EncPacket command frame
  static encode(payload: Uint8Array): Uint8Array {
    return buildEncPacket(0x00, payload); // FRAME_TYPE_COMMAND = 0x00
  }

  // Parse one EncPacket frame from (possibly fragmented) BLE data
  // Returns payload bytes or null if incomplete
  parse(data: Uint8Array): Uint8Array | null {
    if (this.buffer.length > 0) {
      data = concatBytes(this.buffer, data);
      this.buffer = new Uint8Array(0);
    }

    while (data.length > 0) {
      // Find 0x5A5A prefix
      const start = findPrefix(data, 0x5a, 0x5a);
      if (start < 0) return null;
      if (start > 0) data = data.slice(start);

      if (data.length < 8) {
        this.buffer = data;
        return null;
      }

      const payloadLen = readUint16LE(data, 4);
      const dataEnd = 6 + payloadLen;

      if (dataEnd > data.length) {
        // Check for false prefix
        const next = findPrefix(data.slice(2), 0x5a, 0x5a);
        if (next >= 0) {
          data = data.slice(2 + next);
          continue;
        }
        this.buffer = data;
        return null;
      }

      const payloadData = data.slice(6, dataEnd - 2);
      const payloadCrcBytes = data.slice(dataEnd - 2, dataEnd);
      const expectedCrc = readUint16LE(payloadCrcBytes, 0);

      // CRC16 over header + payload
      const headerPlusPayload = concatBytes(data.slice(0, 6), payloadData);
      if (crc16(headerPlusPayload) !== expectedCrc) {
        data = data.slice(2);
        continue;
      }

      return payloadData;
    }

    return null;
  }
}

function findPrefix(data: Uint8Array, b0: number, b1: number): number {
  for (let i = 0; i < data.length - 1; i++) {
    if (data[i] === b0 && data[i + 1] === b1) return i;
  }
  return -1;
}
