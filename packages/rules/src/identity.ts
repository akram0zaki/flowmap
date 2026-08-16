/**
 * Signal identity and condition fingerprints.
 *
 * A signal's key has to survive a restart, a different machine, and an
 * export/import round trip — otherwise a reviewed signal comes back as a new
 * one and the Radar cries wolf. So identity is a hash of stable inputs, never a
 * generated id and never anything derived from evaluation order.
 *
 * SHA-256 is implemented here rather than imported. `node:crypto` is I/O by the
 * purity rule and unavailable in the browser bundle; `crypto.subtle` is async,
 * and the evaluator is synchronous by design. Sixty lines of well-specified
 * arithmetic is a smaller price than making the whole engine async or letting a
 * platform decide our identities.
 *
 * Normative source: docs/spec/04-rules-radar.md §3.
 */

// ── SHA-256 (FIPS 180-4) ───────────────────────────────────────────────────

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/** UTF-8 bytes. Written out because `TextEncoder` is not guaranteed everywhere this runs. */
function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    // Combine a surrogate pair into the single code point it represents.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
      }
    }
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

export function sha256(text: string): number[] {
  const bytes = utf8Bytes(text);
  const bitLength = bytes.length * 8;

  // Pad to a multiple of 64 bytes: 0x80, then zeros, then the length as 64 bits.
  const padded = [...bytes, 0x80];
  while (padded.length % 64 !== 56) padded.push(0);
  // The message length never approaches 2^32 bits here, so the high word is zero.
  padded.push(0, 0, 0, 0);
  padded.push(
    (bitLength >>> 24) & 0xff,
    (bitLength >>> 16) & 0xff,
    (bitLength >>> 8) & 0xff,
    bitLength & 0xff,
  );

  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  const w = new Array<number>(64);

  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    for (let i = 0; i < 16; i += 1) {
      const j = chunk + i * 4;
      w[i] =
        ((padded[j]! << 24) | (padded[j + 1]! << 16) | (padded[j + 2]! << 8) | padded[j + 3]!) >>>
        0;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];

    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + K[i]! + w[i]!) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    const next = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i += 1) h[i] = (h[i]! + next[i]!) >>> 0;
  }

  return h.flatMap((word) => [
    (word >>> 24) & 0xff,
    (word >>> 16) & 0xff,
    (word >>> 8) & 0xff,
    word & 0xff,
  ]);
}

// ── Crockford base32 ───────────────────────────────────────────────────────

/**
 * Crockford's alphabet, matching the one ULIDs use elsewhere in the product.
 * No I, L, O or U, so a key read aloud from a support call is unambiguous.
 */
const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function base32(bytes: readonly number[]): string {
  let out = '';
  let buffer = 0;
  let bits = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(buffer << (5 - bits)) & 31];
  return out;
}

// ── Canonical JSON ─────────────────────────────────────────────────────────

/**
 * A byte-identical rendering of a value, whatever order its keys arrived in.
 *
 * Object key order is an evaluation detail, and spec 04 §8.4 forbids a rule
 * from depending on one. Sorting here is what makes two runs that computed the
 * same facts in a different order produce the same fingerprint.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') {
    // -0 and 0 are the same fact. NaN and Infinity are not facts at all.
    if (!Number.isFinite(value)) return 'null';
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

// ── The two identities ─────────────────────────────────────────────────────

const KEY_LENGTH = 16;

/**
 * Stable identity of a *condition instance*.
 *
 * The discriminator covers which instance of the condition this is, never its
 * magnitude — `CAP_OVERFLOW` is discriminated by team and quarter, not by how
 * many units over it currently runs. Magnitude belongs in the fingerprint.
 */
export function signalKey(ruleCode: string, entityRefKey: string, discriminator = ''): string {
  return base32(sha256(`${ruleCode}|${entityRefKey}|${discriminator}`)).slice(0, KEY_LENGTH);
}

/**
 * Identity of *the situation*, so a review can expire when it stops being true.
 *
 * Built from the rule's declared material facts only. Values that drift on their
 * own — `daysOverdue` climbs every midnight — are deliberately excluded, or
 * every reviewed signal would resurrect itself overnight.
 */
export function conditionFingerprint(materialFacts: Record<string, unknown>): string {
  return base32(sha256(canonicalJson(materialFacts))).slice(0, KEY_LENGTH);
}
