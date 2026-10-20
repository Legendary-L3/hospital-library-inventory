/**
 * sha256.js
 * ---------------------------------------------------------------------------
 * Minimal, dependency-free SHA-256 implementation used to hash the admin
 * password before it is stored.
 *
 * WHY NOT `crypto.subtle`?
 *   The Web Crypto API is only exposed in "secure contexts" (HTTPS, localhost,
 *   and - in most browsers - file://). Because this application is designed to
 *   be opened directly from a shared drive, a USB stick, or an internal HTTP
 *   intranet page, we cannot rely on it being present. A small pure-JS
 *   implementation guarantees identical behaviour everywhere the app runs.
 *
 * SECURITY NOTE (please read before "improving" this):
 *   The admin password hash protects the admin *user interface* only. All data
 *   lives in the browser (localStorage) and in exported JSON files, so a
 *   determined person with access to the computer can read or alter the data
 *   without the password. Treat the password as a deterrent against casual
 *   misuse by consumers at the kiosk, not as a security boundary. Anything
 *   that genuinely needs protecting (e.g. staff-only notes) should not be
 *   stored in this system.
 *
 * Public API:
 *   SHA256.hex(string) -> lower-case hex digest (64 characters)
 *
 * Self-test (run in the browser console):
 *   SHA256.hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  /** Round constants: first 32 bits of the fractional parts of the cube roots of the first 64 primes. */
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  /** Initial hash values: first 32 bits of the fractional parts of the square roots of the first 8 primes. */
  const H_INIT = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  /** Rotate a 32-bit unsigned integer right by n bits. */
  function rotr(x, n) {
    return (x >>> n) | (x << (32 - n));
  }

  /** Encode a JS string as UTF-8 bytes. TextEncoder exists in every browser we support. */
  function utf8Bytes(str) {
    return new TextEncoder().encode(String(str));
  }

  /**
   * Compute the SHA-256 digest of `message` and return it as a hex string.
   * @param {string} message
   * @returns {string} 64-character lower-case hex digest
   */
  function hex(message) {
    const msg = utf8Bytes(message);
    const bitLength = msg.length * 8;

    // Pre-processing: append 0x80, pad with zeros, then the 64-bit big-endian
    // message length so the total is a multiple of 64 bytes (512 bits).
    const paddedLength = Math.ceil((msg.length + 9) / 64) * 64;
    const buffer = new Uint8Array(paddedLength);
    buffer.set(msg);
    buffer[msg.length] = 0x80;
    const view = new DataView(buffer.buffer);
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000)); // high 32 bits
    view.setUint32(paddedLength - 4, bitLength >>> 0);                    // low 32 bits

    const h = H_INIT.slice();
    const w = new Uint32Array(64);

    // Process each 512-bit chunk.
    for (let offset = 0; offset < paddedLength; offset += 64) {
      // Message schedule.
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }

      // Compression function main loop.
      let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        hh = g; g = f; f = e;
        e = (d + t1) >>> 0;
        d = c; c = b; b = a;
        a = (t1 + t2) >>> 0;
      }

      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
      h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
      h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }

    return h.map((x) => x.toString(16).padStart(8, '0')).join('');
  }

  global.SHA256 = { hex };
})(window);
