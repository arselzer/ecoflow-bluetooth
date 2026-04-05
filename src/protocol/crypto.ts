import { concatBytes } from './utils';
import { get8bytes } from './keydata';
import { curve as curveMod } from 'elliptic';
import BN from 'bn.js';

export interface SessionKeys {
  aesKey: Uint8Array;   // 16-byte AES-128-CBC key
  iv: Uint8Array;       // 16-byte IV
  sharedKey: Uint8Array;
}

// ============================================================
// SECP160r1 Elliptic Curve (not in Web Crypto, use elliptic.js)
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const secp160r1Curve = new (curveMod.short as any)({
  p: 'ffffffffffffffffffffffffffffffff7fffffff',
  a: 'ffffffffffffffffffffffffffffffff7ffffffc',
  b: '1c97befc54bd7a8b65acf89f81d4d4adc565fa45',
  n: '0100000000000000000001f4c8f927aed3ca752257',
  g: [
    '4a96b5688ef573284664698968c38bb913cbfc82',
    '23a628553168947d59dcc912042351377ac5fb32',
  ],
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CurvePoint = any;

export interface ECDHKeyPair {
  privateKey: BN;
  publicKey: CurvePoint;
  publicKeyBytes: Uint8Array; // raw 40-byte public key (x || y, no 0x04 prefix)
}

// Generate an ECDH keypair on SECP160r1
export function generateECDHKeyPair(): ECDHKeyPair {
  // Generate random private key in range [1, n-1]
  const n = secp160r1Curve.n!;
  let privKey: BN;
  do {
    const randBytes = new Uint8Array(20);
    crypto.getRandomValues(randBytes);
    privKey = new BN(randBytes);
    privKey = privKey.umod(n);
  } while (privKey.isZero());

  const pubPoint = secp160r1Curve.g.mul(privKey);
  const xBytes = new Uint8Array(pubPoint.getX().toArray('be', 20));
  const yBytes = new Uint8Array(pubPoint.getY().toArray('be', 20));
  const publicKeyBytes = concatBytes(xBytes, yBytes);

  return { privateKey: privKey, publicKey: pubPoint, publicKeyBytes };
}

// Compute ECDH shared secret from our private key and device's public key
export function computeSharedSecret(
  privateKey: BN,
  devicePubKeyBytes: Uint8Array,
): Uint8Array {
  // Device public key is raw bytes (x || y) for SECP160r1
  const keyLen = devicePubKeyBytes.length / 2;
  const x = new BN(devicePubKeyBytes.slice(0, keyLen));
  const y = new BN(devicePubKeyBytes.slice(keyLen));
  const devicePubPoint = secp160r1Curve.point(x, y);

  // Shared secret = privateKey * devicePubKey
  const sharedPoint = devicePubPoint.mul(privateKey);
  // Return the x-coordinate as the shared secret (standard ECDH)
  return new Uint8Array(sharedPoint.getX().toArray('be', 20));
}

// Get ECDH key size from curve_num (returned by device)
export function getEcdhTypeSize(curveNum: number): number {
  switch (curveNum) {
    case 1: return 52;
    case 2: return 56;
    case 3: case 4: return 64;
    default: return 40;
  }
}

// ============================================================
// Type 1 encryption: River 2 / Delta 2
// ============================================================

export function deriveType1Keys(serialNumber: string): SessionKeys {
  const serialBytes = new TextEncoder().encode(serialNumber);
  const reversedBytes = new TextEncoder().encode(serialNumber.split('').reverse().join(''));
  const aesKey = md5Impl(serialBytes);
  const iv = md5Impl(reversedBytes);
  return { aesKey, iv, sharedKey: aesKey };
}

// ============================================================
// Type 7 encryption: River 3 / Delta 3 / SHP2 / DPU
// ============================================================

// Step 1: After ECDH, derive initial encryption from shared key
export function deriveType7InitialKeys(sharedSecret: Uint8Array): SessionKeys {
  const iv = md5Impl(sharedSecret);
  return { aesKey: sharedSecret.slice(0, 16), iv, sharedKey: sharedSecret };
}

// Step 2: Generate final session key from seed + srand + keydata
// Mirrors rabits/ha-ef-ble genSessionKey()
export function generateType7SessionKey(seed: Uint8Array, srand: Uint8Array): Uint8Array {
  // seed is 2 bytes, srand is 16 bytes
  // pos = seed[0] * 0x10 + ((seed[1] - 1) & 0xFF) * 0x100
  const pos = seed[0] * 0x10 + ((seed[1] - 1) & 0xff) * 0x100;

  // Get 16 bytes from keydata at computed position
  const keyBytes0 = get8bytes(pos);
  const keyBytes1 = get8bytes(pos + 8);

  // Combine: 16 bytes from keydata + 16 bytes from srand
  const combined = concatBytes(keyBytes0, keyBytes1, srand.slice(0, 8), srand.slice(8, 16));

  return md5Impl(combined);
}

// Step 3: Generate authentication payload
// auth = MD5(user_id + device_sn) as uppercase hex ASCII
export function generateAuthPayload(userId: string, deviceSn: string): Uint8Array {
  const input = new TextEncoder().encode(userId + deviceSn);
  const hash = md5Impl(input);
  // Convert to uppercase hex string, then to ASCII bytes
  const hexStr = Array.from(hash).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
  return new TextEncoder().encode(hexStr);
}

// ============================================================
// MD5 implementation (needed because Web Crypto doesn't support MD5)
// ============================================================

export function md5Impl(message: Uint8Array): Uint8Array {
  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = new Uint32Array([
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ]);

  function leftRotate(x: number, c: number): number {
    return ((x << c) | (x >>> (32 - c))) >>> 0;
  }

  let a0 = 0x67452301 >>> 0;
  let b0 = 0xefcdab89 >>> 0;
  let c0 = 0x98badcfe >>> 0;
  let d0 = 0x10325476 >>> 0;

  const origLen = message.length;
  const bitLen = origLen * 8;
  const paddedLen = ((origLen + 8) >>> 6) * 64 + 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(message);
  padded[origLen] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, bitLen >>> 0, true);
  view.setUint32(paddedLen - 4, 0, true);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) {
      M[j] = view.getUint32(offset + j * 4, true);
    }

    let A = a0, B = b0, C = c0, D = d0;

    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) {
        F = ((B & C) | (~B & D)) >>> 0;
        g = i;
      } else if (i < 32) {
        F = ((D & B) | (~D & C)) >>> 0;
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = (B ^ C ^ D) >>> 0;
        g = (3 * i + 5) % 16;
      } else {
        F = (C ^ (B | ~D)) >>> 0;
        g = (7 * i) % 16;
      }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + leftRotate(F, s[i])) >>> 0;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const result = new Uint8Array(16);
  const rv = new DataView(result.buffer);
  rv.setUint32(0, a0, true);
  rv.setUint32(4, b0, true);
  rv.setUint32(8, c0, true);
  rv.setUint32(12, d0, true);
  return result;
}

// ============================================================
// AES-128-CBC encryption/decryption
// ============================================================

// Type 7: PKCS7 padding
export async function encryptAesCbc(
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'AES-CBC' }, false, ['encrypt'],
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv },
    cryptoKey,
    data,
  );
  return new Uint8Array(encrypted);
}

// Type 7: decrypt with PKCS7 unpadding, aligned to block boundary
export async function decryptAesCbc(
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
): Promise<Uint8Array> {
  // Align to AES block boundary (firmware behavior)
  const blockSize = 16;
  const aligned = data.length - (data.length % blockSize);
  if (aligned === 0) return data;

  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'AES-CBC' }, false, ['decrypt'],
  );
  const toDecrypt = data.slice(0, aligned);

  try {
    // Try with PKCS7 unpadding (Web Crypto default)
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv },
      cryptoKey,
      toDecrypt,
    );
    return new Uint8Array(decrypted);
  } catch {
    // If PKCS7 unpadding fails, decrypt raw and return as-is
    // This happens with Type 1 null-padded data
    try {
      // Add a fake PKCS7 block to allow decryption without padding check
      const padded = new Uint8Array(toDecrypt.length + blockSize);
      padded.set(toDecrypt);
      // Fill last block with 0x10 (valid PKCS7 for a full-block pad)
      for (let i = toDecrypt.length; i < padded.length; i++) {
        padded[i] = blockSize;
      }
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-CBC', iv },
        cryptoKey,
        padded,
      );
      // Return only the original data length (minus the fake padding)
      return new Uint8Array(decrypted).slice(0, toDecrypt.length);
    } catch {
      throw new Error('AES-CBC decryption failed');
    }
  }
}
