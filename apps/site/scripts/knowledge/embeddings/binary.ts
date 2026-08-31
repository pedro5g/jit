/**
 * Float32 vectors as bytes.
 *
 * Little-endian, no header, no separators. Both sides of this are ours — the
 * writer here and the reader in the browser — and the length is known from the
 * manifest's `dimensions`, so a header would only encode something already
 * known. The absence of one is what makes the whole file a single
 * `new Float32Array(buffer)` on the reading side.
 *
 * One assumption is load-bearing: every machine this runs on is
 * little-endian. That is true of x64 and of every ARM configuration in
 * practice, and it is asserted rather than handled — a big-endian build would
 * produce a file that parses cleanly and ranks randomly, which is far worse
 * than a build that refuses.
 */

const probe = new Uint8Array(new Uint16Array([1]).buffer);
export const IS_LITTLE_ENDIAN = probe[0] === 1;

export function assertLittleEndian(): void {
  if (!IS_LITTLE_ENDIAN) {
    throw new Error(
      "knowledge artifacts are little-endian; this machine is not, and the vectors would be silently wrong"
    );
  }
}

export function toBuffer(vector: Float32Array): Buffer {
  assertLittleEndian();
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function fromBuffer(buffer: Buffer, dimensions: number): Float32Array {
  assertLittleEndian();
  if (buffer.byteLength !== dimensions * 4) {
    throw new Error(`expected ${dimensions * 4} bytes, got ${buffer.byteLength}`);
  }

  // `buffer` may be a view into a larger pool, so the bytes are copied rather
  // than aliased — a Float32Array over a pooled offset reads its neighbours.
  const copy = new Float32Array(dimensions);
  for (let i = 0; i < dimensions; i++) copy[i] = buffer.readFloatLE(i * 4);

  return copy;
}

/**
 * Scales a vector to unit length.
 *
 * The search takes a dot product and calls it a cosine, which is only true if
 * both sides are normalized. Doing it once here rather than at query time
 * means the browser never divides by a magnitude it would have to compute over
 * every stored vector.
 */
export function normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vector.length; i++) sum += vector[i] * vector[i];

  const magnitude = Math.sqrt(sum);
  if (magnitude === 0) return vector;

  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = vector[i] / magnitude;

  return out;
}
