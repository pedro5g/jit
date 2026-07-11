import { bench, do_not_optimize, group } from "mitata";
import { runSuite } from "../shared/persist.js";

const COUNT = 300_000;
const MAX_BYTES = 16;
const LENGTH_BYTES = 2;
const STRIDE = LENGTH_BYTES + MAX_BYTES;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface DictionaryStorage {
  readonly ids: Map<string, number>;
  readonly values: string[];
  readonly codes: Uint32Array;
}

interface InlineStorage {
  readonly bytes: Uint8Array;
  readonly hashes: Uint32Array;
}

for (const cardinality of [32, 10_000, COUNT]) {
  const values = createValues(COUNT, cardinality);
  const dictionary = loadDictionary(values);
  const inline = loadInline(values);
  const target = `user-${cardinality - 1}`;
  const targetCode = dictionary.ids.get(target);
  const targetHash = hashString(target);
  const targetBytes = encoder.encode(target);

  group(`${COUNT} strings / cardinality ${cardinality}`, () => {
    bench("dictionary load", () => do_not_optimize(loadDictionary(values)));
    bench("inline hash load", () => do_not_optimize(loadInline(values)));
    bench("dictionary equality scan", () => do_not_optimize(scanDictionary(dictionary.codes, targetCode)));
    bench("inline exact equality scan", () => do_not_optimize(scanInline(inline, targetHash, targetBytes, STRIDE)));
  });

  if (cardinality === COUNT) {
    group(`${COUNT} unique strings / hydrate`, () => {
      bench("dictionary hydrate", () => do_not_optimize(hydrateDictionary(dictionary)));
      bench("inline hydrate", () => do_not_optimize(hydrateInline(inline, STRIDE)));
    });
  }
}

function createValues(count: number, cardinality: number): string[] {
  const values = new Array<string>(count);

  for (let index = 0; index < count; index++) values[index] = `user-${index % cardinality}`;
  return values;
}

function loadDictionary(input: readonly string[]): DictionaryStorage {
  const ids = new Map<string, number>();
  const values: string[] = [];
  const codes = new Uint32Array(input.length);

  for (let index = 0; index < input.length; index++) {
    const value = input[index];
    let code = ids.get(value);

    if (code === undefined) {
      code = values.length;
      ids.set(value, code);
      values[code] = value;
    }
    codes[index] = code;
  }
  return { ids, values, codes };
}

function loadInline(input: readonly string[]): InlineStorage {
  const bytes = new Uint8Array(input.length * STRIDE);
  const hashes = new Uint32Array(input.length);

  for (let index = 0; index < input.length; index++) {
    const value = input[index];
    const offset = index * STRIDE;
    const result = encoder.encodeInto(value, bytes.subarray(offset + LENGTH_BYTES, offset + STRIDE));

    if (result.read !== value.length) throw new RangeError(`fixture exceeds ${MAX_BYTES} UTF-8 bytes`);
    bytes[offset] = result.written;
    bytes[offset + 1] = result.written >>> 8;
    hashes[index] = hashString(value);
  }
  return { bytes, hashes };
}

function scanDictionary(codes: Uint32Array, target: number | undefined): number {
  let count = 0;

  for (let index = 0; index < codes.length; index++) {
    if (codes[index] === target) count++;
  }
  return count;
}

function scanInline(storage: InlineStorage, targetHash: number, target: Uint8Array, stride: number): number {
  const { bytes, hashes } = storage;
  let count = 0;

  for (let index = 0; index < hashes.length; index++) {
    if (hashes[index] !== targetHash) continue;
    const offset = index * stride;
    const length = bytes[offset] | (bytes[offset + 1] << 8);

    if (length === target.length && bytesEqual(bytes, offset + LENGTH_BYTES, target)) count++;
  }
  return count;
}

function bytesEqual(source: Uint8Array, offset: number, target: Uint8Array): boolean {
  for (let index = 0; index < target.length; index++) {
    if (source[offset + index] !== target[index]) return false;
  }
  return true;
}

function hydrateDictionary(storage: DictionaryStorage): string[] {
  const out = new Array<string>(storage.codes.length);

  for (let index = 0; index < storage.codes.length; index++) out[index] = storage.values[storage.codes[index]];
  return out;
}

function hydrateInline(storage: InlineStorage, stride: number): string[] {
  const out = new Array<string>(storage.hashes.length);

  for (let index = 0; index < storage.hashes.length; index++) {
    const offset = index * stride;
    const length = storage.bytes[offset] | (storage.bytes[offset + 1] << 8);
    out[index] = decoder.decode(storage.bytes.subarray(offset + LENGTH_BYTES, offset + LENGTH_BYTES + length));
  }
  return out;
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

await runSuite("binary-strings");
