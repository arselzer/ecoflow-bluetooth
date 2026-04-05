import { PACKET_PREFIX, ENC_PACKET_PREFIX } from './constants';
import { crc8, crc16, toHex, readUint16LE, readUint32LE, writeUint16LE, writeUint32LE, concatBytes } from './utils';
import type { EcoFlowPacket, EncPacket } from './types';

// Sequence counter for outgoing packets
let sequenceCounter = 1;

export function nextSequence(): number {
  return sequenceCounter++;
}

// Build an inner EcoFlow packet (0xAA prefix)
export function buildPacket(
  src: number,
  dst: number,
  cmdSet: number,
  cmdId: number,
  payload: Uint8Array,
  seq?: number,
): Uint8Array {
  const version = 0x03; // Protocol version
  const seqNum = seq ?? nextSequence();

  // Packet body: seq(4) + 0x00 + 0x00 + src + dst + dsrc(0) + ddst(0) + cmdSet + cmdId + payload
  const body = concatBytes(
    writeUint32LE(seqNum),
    new Uint8Array([0x00, 0x00]),  // reserved
    new Uint8Array([src, dst]),
    new Uint8Array([0x00, 0x00]),  // dsrc, ddst
    new Uint8Array([cmdSet, cmdId]),
    payload,
  );

  // Length = body length + 2 (CRC16)
  const length = body.length + 2;

  // Header: 0xAA + version + length(2 LE)
  const header = new Uint8Array([
    PACKET_PREFIX,
    version,
    length & 0xff,
    (length >> 8) & 0xff,
  ]);

  const headerCrcVal = crc8(header);

  // Full packet: header + headerCRC + body + bodyCRC16
  const withoutCrc16 = concatBytes(header, new Uint8Array([headerCrcVal]), body);
  const bodyCrc = crc16(body);

  return concatBytes(withoutCrc16, writeUint16LE(bodyCrc));
}

// Build an encrypted outer packet (0x5A5A prefix)
export function buildEncPacket(
  frameType: number,
  encryptedPayload: Uint8Array,
): Uint8Array {
  const payloadType = 0x01;
  const length = encryptedPayload.length;

  const header = concatBytes(
    writeUint16LE(ENC_PACKET_PREFIX),
    new Uint8Array([frameType, payloadType]),
    writeUint16LE(length),
  );

  const payloadCrc = crc16(encryptedPayload);

  return concatBytes(header, encryptedPayload, writeUint16LE(payloadCrc));
}

// Parse an inner packet (0xAA prefix)
export function parsePacket(data: Uint8Array): EcoFlowPacket | null {
  if (data.length < 10) return null;

  if (data[0] !== PACKET_PREFIX) {
    return null;
  }

  const version = data[1];
  const length = readUint16LE(data, 2);
  const headerCrcVal = data[4];

  // Verify header CRC
  const computedHeaderCrc = crc8(data.slice(0, 4));
  if (computedHeaderCrc !== headerCrcVal) {
    console.warn('[Packet] Header CRC mismatch:', headerCrcVal.toString(16), 'vs', computedHeaderCrc.toString(16));
  }

  const bodyStart = 5;
  const bodyEnd = Math.min(data.length - 2, bodyStart + length - 2);

  if (bodyEnd <= bodyStart) return null;

  const body = data.slice(bodyStart, bodyEnd);

  // Parse body fields
  const seq = readUint32LE(body, 0);
  // bytes 4,5 are reserved (0x00, 0x00)
  const src = body[6];
  const dst = body[7];
  const dsrc = body[8];
  const ddst = body[9];
  const cmdSet = body[10];
  const cmdId = body[11];
  const payload = body.slice(12);

  // CRC16 at end
  const crc16Val = readUint16LE(data, data.length - 2);

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

  const prefix = readUint16LE(data, 0);
  if (prefix !== ENC_PACKET_PREFIX) {
    return null;
  }

  const frameType = data[2];
  const payloadType = data[3];
  const length = readUint16LE(data, 4);

  if (data.length < 6 + length + 2) return null;

  const encryptedPayload = data.slice(6, 6 + length);
  const crc16Val = readUint16LE(data, 6 + length);

  return {
    prefix,
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
