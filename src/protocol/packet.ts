import { PACKET_PREFIX, ENC_PACKET_PREFIX } from './constants';
import { crc8, crc16, toHex, readUint16LE, readUint32LE, writeUint16LE, writeUint32LE, concatBytes } from './utils';
import type { EcoFlowPacket, EncPacket } from './types';

// Sequence counter for outgoing packets
let sequenceCounter = 1;

export function nextSequence(): number {
  return sequenceCounter++;
}

// Build an inner EcoFlow packet (0xAA prefix, protocol version 2)
// Format: [0xAA][version][length_LE][CRC8][product_byte][seq_4B][0x00 0x00][src][dst][cmdSet][cmdId][payload][CRC16]
export function buildPacket(
  src: number,
  dst: number,
  cmdSet: number,
  cmdId: number,
  payload: Uint8Array,
  seq?: number,
): Uint8Array {
  const version = 0x02; // Protocol version 2 for River 2
  const seqNum = seq ?? nextSequence();
  const productByte = 0x0d; // product_id >= 0

  // Body: product_byte + seq(4) + reserved(2) + src + dst + cmdSet + cmdId + payload
  const body = concatBytes(
    new Uint8Array([productByte]),
    writeUint32LE(seqNum),
    new Uint8Array([0x00, 0x00]),  // reserved
    new Uint8Array([src, dst]),
    new Uint8Array([cmdSet, cmdId]),
    payload,
  );

  // XOR obfuscation: if seq[0] != 0, XOR the payload portion
  const seqByte0 = seqNum & 0xff;
  if (seqByte0 !== 0 && payload.length > 0) {
    // The payload starts at offset 11 within body (after product+seq+reserved+src+dst+cmdSet+cmdId)
    const payloadStart = 11;
    for (let i = payloadStart; i < body.length; i++) {
      body[i] ^= seqByte0;
    }
  }

  // Payload length field = body length + 2 (for CRC16)
  const payloadLen = body.length + 2;

  // Header: 0xAA + version + length_LE(2)
  const header = new Uint8Array([
    PACKET_PREFIX,
    version,
    payloadLen & 0xff,
    (payloadLen >> 8) & 0xff,
  ]);

  const headerCrcVal = crc8(header);

  // CRC16 over body
  const bodyCrcVal = crc16(body);

  return concatBytes(header, new Uint8Array([headerCrcVal]), body, writeUint16LE(bodyCrcVal));
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

  const payloadCrc = crc16(encryptedPayload);
  return concatBytes(header, encryptedPayload, writeUint16LE(payloadCrc));
}

// Parse an inner packet (0xAA prefix)
export function parsePacket(data: Uint8Array): EcoFlowPacket | null {
  if (data.length < 10) return null;
  if (data[0] !== PACKET_PREFIX) return null;

  const version = data[1];
  const length = readUint16LE(data, 2);
  const headerCrcVal = data[4];

  // Verify header CRC8
  const computedHeaderCrc = crc8(data.slice(0, 4));
  if (computedHeaderCrc !== headerCrcVal) {
    console.warn('[Packet] Header CRC8 mismatch:', headerCrcVal.toString(16), 'vs', computedHeaderCrc.toString(16));
  }

  const bodyStart = 5;
  // Body length = length - 2 (CRC16)
  const bodyLen = length - 2;
  const bodyEnd = bodyStart + bodyLen;

  if (bodyEnd + 2 > data.length) return null;

  const body = data.slice(bodyStart, bodyEnd);

  // Parse based on protocol version
  let src: number, dst: number, dsrc: number, ddst: number, cmdSet: number, cmdId: number;
  let payload: Uint8Array;
  let seq: number;

  // Version 2: product_byte + seq(4) + reserved(2) + src + dst + cmdSet + cmdId + payload
  if (version === 2 || version === 0x02) {
    if (body.length < 11) return null;
    // body[0] = product_byte
    seq = readUint32LE(body, 1);
    // body[5], body[6] = reserved
    src = body[7];
    dst = body[8];
    dsrc = 0;
    ddst = 0;
    cmdSet = body[9];
    cmdId = body[10];
    payload = body.slice(11);

    // Undo XOR obfuscation
    const seqByte0 = seq & 0xff;
    if (seqByte0 !== 0 && payload.length > 0) {
      payload = new Uint8Array(payload);
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= seqByte0;
      }
    }
  }
  // Version 3/4: product_byte + seq(4) + reserved(2) + src + dst + dsrc + ddst + cmdSet + cmdId + payload
  else if (version === 3 || version === 4 || version === 0x13) {
    if (body.length < 13) return null;
    seq = readUint32LE(body, 1);
    src = body[7];
    dst = body[8];
    dsrc = body[9];
    ddst = body[10];
    cmdSet = body[11];
    cmdId = body[12];
    payload = body.slice(13);

    const seqByte0 = seq & 0xff;
    if (seqByte0 !== 0 && payload.length > 0) {
      payload = new Uint8Array(payload);
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= seqByte0;
      }
    }
  } else {
    // Unknown version — best effort
    seq = body.length >= 5 ? readUint32LE(body, 1) : 0;
    src = body.length > 7 ? body[7] : 0;
    dst = body.length > 8 ? body[8] : 0;
    dsrc = 0;
    ddst = 0;
    cmdSet = body.length > 9 ? body[9] : 0;
    cmdId = body.length > 10 ? body[10] : 0;
    payload = body.length > 11 ? body.slice(11) : new Uint8Array(0);
  }

  const crc16Val = readUint16LE(data, bodyEnd);

  // Verify CRC16
  const computedCrc16 = crc16(body);
  if (computedCrc16 !== crc16Val) {
    console.warn('[Packet] CRC16 mismatch:', crc16Val.toString(16), 'vs', computedCrc16.toString(16));
  }

  return {
    header: PACKET_PREFIX,
    version,
    length,
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
