import { toHex } from './utils';

export interface SessionKeys {
  aesKey: Uint8Array;   // 16-byte AES-128-CBC key
  iv: Uint8Array;       // 16-byte IV derived from MD5(shared_key)
  sharedKey: Uint8Array;
}

// MD5 implementation for key derivation
// EcoFlow uses MD5 for session key generation and IV derivation
async function md5(data: Uint8Array): Promise<Uint8Array> {
  // Web Crypto doesn't support MD5 directly, so we implement it
  return md5Impl(data);
}

function md5Impl(message: Uint8Array): Uint8Array {
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

  // Pre-processing: adding padding bits
  const paddedLen = ((origLen + 8) >>> 6) * 64 + 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(message);
  padded[origLen] = 0x80;
  // Append original length in bits as 64-bit LE
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, bitLen >>> 0, true);
  view.setUint32(paddedLen - 4, 0, true); // upper 32 bits of length (0 for messages < 512MB)

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

// Derive IV from shared key: IV = MD5(shared_key)
export async function deriveIV(sharedKey: Uint8Array): Promise<Uint8Array> {
  return await md5(sharedKey);
}

// Generate session key from login_key seed and srand
// session_key = MD5(login_key[seed] + srand)
export async function generateSessionKey(loginKeyEntry: Uint8Array, srand: Uint8Array): Promise<Uint8Array> {
  const combined = new Uint8Array(loginKeyEntry.length + srand.length);
  combined.set(loginKeyEntry);
  combined.set(srand, loginKeyEntry.length);
  return await md5(combined);
}

// Generate authentication hash: MD5(user_id + serial_number) as ASCII hex
export async function generateAuthHash(userId: string, serialNumber: string): Promise<string> {
  const input = new TextEncoder().encode(userId + serialNumber);
  const hash = await md5(input);
  return toHex(hash);
}

// AES-128-CBC encryption
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

// AES-128-CBC decryption
export async function decryptAesCbc(
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'AES-CBC' }, false, ['decrypt'],
  );
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv },
      cryptoKey,
      data,
    );
    return new Uint8Array(decrypted);
  } catch {
    // If standard PKCS7 padding fails, try manual block alignment
    const blockSize = 16;
    if (data.length % blockSize !== 0) {
      const paddedLen = Math.ceil(data.length / blockSize) * blockSize;
      const padded = new Uint8Array(paddedLen);
      padded.set(data);
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-CBC', iv },
        cryptoKey,
        padded,
      );
      return new Uint8Array(decrypted);
    }
    throw new Error('AES-CBC decryption failed');
  }
}
