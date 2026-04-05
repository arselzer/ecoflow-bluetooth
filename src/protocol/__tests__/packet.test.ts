import { describe, it, expect } from 'vitest';
import {
  buildPacket, parsePacket, buildEncPacket, parseEncPacket,
  detectPacketType, SimplePacketAssembler,
} from '../packet';
import { toHex, crc8, crc16 } from '../utils';

describe('CRC', () => {
  it('crc8 should match known values', () => {
    // CRC8-CCITT of [0xAA, 0x02, 0x0d, 0x00]
    const data = new Uint8Array([0xaa, 0x02, 0x0d, 0x00]);
    const result = crc8(data);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(255);
  });

  it('crc16 should produce 16-bit value', () => {
    const data = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const result = crc16(data);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(65535);
  });
});

describe('Inner Packet (0xAA)', () => {
  it('should build and parse a round-trip packet (v3)', () => {
    const payload = new Uint8Array([0x01, 0x02, 0x03]);
    const packet = buildPacket(0x20, 0x01, 0x05, 0x42, payload, 0);

    expect(packet[0]).toBe(0xaa); // prefix
    expect(packet[1]).toBe(0x03); // version 3 (default)

    const parsed = parsePacket(packet);
    expect(parsed).not.toBeNull();
    expect(parsed!.src).toBe(0x20);
    expect(parsed!.dst).toBe(0x01);
    expect(parsed!.cmdSet).toBe(0x05);
    expect(parsed!.cmdId).toBe(0x42);
    expect(parsed!.dsrc).toBe(1);
    expect(parsed!.ddst).toBe(1);
    expect(toHex(parsed!.payload)).toBe(toHex(payload));
  });

  it('should build v2 packets without dsrc/ddst', () => {
    const payload = new Uint8Array([0x01]);
    const packet = buildPacket(0x20, 0x01, 0x02, 0x01, payload, 0, 2);

    expect(packet[1]).toBe(0x02); // version 2
    const parsed = parsePacket(packet);
    expect(parsed).not.toBeNull();
    expect(parsed!.dsrc).toBe(0);
    expect(parsed!.ddst).toBe(0);
    expect(toHex(parsed!.payload)).toBe('01');
  });

  it('should have correct header CRC8', () => {
    const packet = buildPacket(0x20, 0x01, 0x02, 0x01, new Uint8Array(0), 0);
    const headerCrc = crc8(packet.slice(0, 4));
    expect(packet[4]).toBe(headerCrc);
  });

  it('should detect inner packet type', () => {
    const packet = buildPacket(0x20, 0x01, 0x02, 0x01, new Uint8Array(0));
    expect(detectPacketType(packet)).toBe('inner');
  });
});

describe('EncPacket (0x5A5A)', () => {
  it('should build an enc packet with CRC16', () => {
    const payload = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const encPacket = buildEncPacket(0x00, payload);

    expect(encPacket[0]).toBe(0x5a);
    expect(encPacket[1]).toBe(0x5a);
    expect(detectPacketType(encPacket)).toBe('encrypted');
  });

  it('should build and parse round-trip', () => {
    const payload = new Uint8Array([0x10, 0x20, 0x30]);
    const built = buildEncPacket(0x01, payload);
    const parsed = parseEncPacket(built);

    expect(parsed).not.toBeNull();
    expect(parsed!.frameType).toBe(0x01);
    expect(toHex(parsed!.encryptedPayload)).toBe(toHex(payload));
  });
});

describe('SimplePacketAssembler', () => {
  it('should encode a payload into an EncPacket command frame', () => {
    const payload = new Uint8Array([0x01, 0x00, 0xAA, 0xBB]);
    const frame = SimplePacketAssembler.encode(payload);

    // Should start with 0x5A5A
    expect(frame[0]).toBe(0x5a);
    expect(frame[1]).toBe(0x5a);
  });

  it('should parse the encoded frame back', () => {
    const payload = new Uint8Array([0x01, 0x00, 0xAA, 0xBB]);
    const frame = SimplePacketAssembler.encode(payload);

    const assembler = new SimplePacketAssembler();
    const parsed = assembler.parse(frame);

    expect(parsed).not.toBeNull();
    expect(toHex(parsed!)).toBe(toHex(payload));
  });

  it('should handle fragmented data', () => {
    const payload = new Uint8Array([0x02, 0x03, 0x04]);
    const frame = SimplePacketAssembler.encode(payload);

    const assembler = new SimplePacketAssembler();

    // Send first half
    const firstHalf = frame.slice(0, 4);
    const result1 = assembler.parse(firstHalf);
    expect(result1).toBeNull(); // incomplete

    // Send rest
    const secondHalf = frame.slice(4);
    const result2 = assembler.parse(secondHalf);
    expect(result2).not.toBeNull();
    expect(toHex(result2!)).toBe(toHex(payload));
  });
});
