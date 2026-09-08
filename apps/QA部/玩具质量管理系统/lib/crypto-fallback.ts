// 非安全上下文（http:// 内网部署）降级方案。
// crypto.subtle 与 crypto.randomUUID 仅在 HTTPS/localhost 可用，
// 系统部署在 http 内网，没有它们会导致启动即崩溃（卡在「正在载入」）。
// 这里提供与 WebCrypto 字节级一致的 PBKDF2-HMAC-SHA256 纯 JS 实现，
// 以及基于 crypto.getRandomValues（非安全上下文可用）的 UUIDv4。

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256Blocks(data: Uint8Array): Uint8Array {
  const bitLen = data.length * 8;
  const paddedLen = (((data.length + 8) >> 6) + 1) << 6;
  const buf = new Uint8Array(paddedLen);
  buf.set(data);
  buf[data.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(paddedLen - 4, bitLen >>> 0);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000));

  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Int32Array(64);
  for (let off = 0; off < paddedLen; off += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getInt32(off + t * 4);
    for (let t = 16; t < 64; t++) {
      const s0 = ((w[t - 15] >>> 7) | (w[t - 15] << 25)) ^ ((w[t - 15] >>> 18) | (w[t - 15] << 14)) ^ (w[t - 15] >>> 3);
      const s1 = ((w[t - 2] >>> 17) | (w[t - 2] << 15)) ^ ((w[t - 2] >>> 19) | (w[t - 2] << 13)) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[t] + w[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i] >>> 0);
  return out;
}

function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const block = key.length > 64 ? sha256Blocks(key) : key;
  const ipad = new Uint8Array(64 + message.length);
  const opadKey = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    const kb = i < block.length ? block[i] : 0;
    ipad[i] = kb ^ 0x36;
    opadKey[i] = kb ^ 0x5c;
  }
  ipad.set(message, 64);
  const inner = sha256Blocks(ipad);
  const opad = new Uint8Array(64 + 32);
  opad.set(opadKey);
  opad.set(inner, 64);
  return sha256Blocks(opad);
}

/** PBKDF2-HMAC-SHA256，输出与 WebCrypto deriveBits 完全一致（dkLen 不超过 32 字节，系统只用 256 位）。 */
export function pbkdf2Sha256(password: Uint8Array, salt: Uint8Array, iterations: number, dkLen: number): Uint8Array {
  if (dkLen > 32) throw new Error("pbkdf2Sha256 仅支持 dkLen <= 32");
  const block = new Uint8Array(salt.length + 4);
  block.set(salt);
  block[block.length - 4] = 0;
  block[block.length - 3] = 0;
  block[block.length - 2] = 0;
  block[block.length - 1] = 1; // block index = 1（big-endian）
  let u = hmacSha256(password, block);
  const t = new Uint8Array(u);
  for (let i = 1; i < iterations; i++) {
    u = hmacSha256(password, u);
    for (let j = 0; j < 32; j++) t[j] ^= u[j];
  }
  return t.slice(0, dkLen);
}

export function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

const encoder = new TextEncoder();

/** 密码哈希：优先 WebCrypto，非安全上下文降级纯 JS（输出一致，与服务端/备份格式兼容）。 */
export async function hashPasswordCompat(password: string, saltBase64: string): Promise<string> {
  const salt = base64ToBytes(saltBase64);
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" }, material, 256);
    return bytesToBase64(new Uint8Array(bits));
  }
  return bytesToBase64(pbkdf2Sha256(encoder.encode(password), salt, 120000, 32));
}

/** 随机盐（getRandomValues 在非安全上下文也可用）。 */
export function randomSaltBase64(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
}

/** UUIDv4：优先 crypto.randomUUID，非安全上下文用 getRandomValues 生成。 */
export function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
