import { describe, it, expect } from 'vitest';
import {
  md5Impl, deriveType1Keys,
  generateECDHKeyPair, computeSharedSecret,
  deriveType7InitialKeys, generateType7SessionKey,
  generateAuthPayload, encryptAesCbc, decryptAesCbc,
} from '../crypto';
import { toHex } from '../utils';

describe('MD5', () => {
  it('should hash empty string correctly', () => {
    const hash = md5Impl(new Uint8Array(0));
    expect(toHex(hash)).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  it('should hash "abc" correctly', () => {
    const hash = md5Impl(new TextEncoder().encode('abc'));
    expect(toHex(hash)).toBe('900150983cd24fb0d6963f7d28e17f72');
  });

  it('should hash a serial number', () => {
    const hash = md5Impl(new TextEncoder().encode('R6030000000000'));
    expect(toHex(hash)).toHaveLength(32);
  });
});

describe('Type 1 Keys', () => {
  it('should derive key = MD5(serial), IV = MD5(reversed serial)', () => {
    const serial = 'R6030TEST12345';
    const keys = deriveType1Keys(serial);

    expect(keys.aesKey).toHaveLength(16);
    expect(keys.iv).toHaveLength(16);
    expect(toHex(keys.aesKey)).not.toBe(toHex(keys.iv));

    // Verify key = MD5(serial)
    const expectedKey = md5Impl(new TextEncoder().encode(serial));
    expect(toHex(keys.aesKey)).toBe(toHex(expectedKey));

    // Verify IV = MD5(reversed serial)
    const reversed = serial.split('').reverse().join('');
    const expectedIv = md5Impl(new TextEncoder().encode(reversed));
    expect(toHex(keys.iv)).toBe(toHex(expectedIv));
  });
});

describe('ECDH SECP160r1', () => {
  it('should generate a key pair with 40-byte public key', () => {
    const kp = generateECDHKeyPair();
    expect(kp.publicKeyBytes).toHaveLength(40); // 20 bytes x + 20 bytes y
  });

  it('should compute matching shared secrets', () => {
    const kp1 = generateECDHKeyPair();
    const kp2 = generateECDHKeyPair();

    const shared1 = computeSharedSecret(kp1.privateKey, kp2.publicKeyBytes);
    const shared2 = computeSharedSecret(kp2.privateKey, kp1.publicKeyBytes);

    expect(toHex(shared1)).toBe(toHex(shared2));
    expect(shared1.length).toBeLessThanOrEqual(20);
  });

  it('should derive Type 7 initial keys from shared secret', () => {
    const kp1 = generateECDHKeyPair();
    const kp2 = generateECDHKeyPair();
    const shared = computeSharedSecret(kp1.privateKey, kp2.publicKeyBytes);

    const keys = deriveType7InitialKeys(shared);
    expect(keys.aesKey).toHaveLength(16);
    expect(keys.iv).toHaveLength(16);
    // IV should be MD5 of shared secret
    const expectedIv = md5Impl(shared);
    expect(toHex(keys.iv)).toBe(toHex(expectedIv));
  });
});

describe('Type 7 Session Key', () => {
  it('should generate a 16-byte session key from seed and srand', () => {
    const seed = new Uint8Array([0x05, 0x01]);
    const srand = new Uint8Array(16);
    crypto.getRandomValues(srand);

    const sessionKey = generateType7SessionKey(seed, srand);
    expect(sessionKey).toHaveLength(16);
  });

  it('should produce different keys for different seeds', () => {
    const srand = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const key1 = generateType7SessionKey(new Uint8Array([0x01, 0x01]), srand);
    const key2 = generateType7SessionKey(new Uint8Array([0x02, 0x01]), srand);
    expect(toHex(key1)).not.toBe(toHex(key2));
  });
});

describe('Auth Payload', () => {
  it('should generate uppercase hex MD5 as ASCII bytes', () => {
    const payload = generateAuthPayload('12345', 'R6030TEST');
    // Should be 32 ASCII characters (hex representation of MD5)
    expect(payload).toHaveLength(32);
    // All bytes should be ASCII hex chars (0-9, A-F)
    const text = new TextDecoder().decode(payload);
    expect(text).toMatch(/^[0-9A-F]{32}$/);
  });
});

describe('AES-CBC', () => {
  it('should encrypt and decrypt round-trip', async () => {
    const key = new Uint8Array(16);
    const iv = new Uint8Array(16);
    crypto.getRandomValues(key);
    crypto.getRandomValues(iv);

    const plaintext = new TextEncoder().encode('Hello EcoFlow BLE!');
    const encrypted = await encryptAesCbc(plaintext, key, iv);
    expect(encrypted.length).toBeGreaterThan(0);
    expect(encrypted.length % 16).toBe(0); // PKCS7 padded

    const decrypted = await decryptAesCbc(encrypted, key, iv);
    expect(new TextDecoder().decode(decrypted)).toBe('Hello EcoFlow BLE!');
  });

  it('should handle block-aligned data', async () => {
    const key = new Uint8Array(16);
    const iv = new Uint8Array(16);
    crypto.getRandomValues(key);
    crypto.getRandomValues(iv);

    // Exactly 16 bytes (one block)
    const plaintext = new Uint8Array(16);
    plaintext.fill(0x42);

    const encrypted = await encryptAesCbc(plaintext, key, iv);
    const decrypted = await decryptAesCbc(encrypted, key, iv);
    expect(toHex(decrypted)).toBe(toHex(plaintext));
  });
});
