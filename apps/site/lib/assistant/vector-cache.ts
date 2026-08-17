/**
 * Embedding every documentation section takes minutes on a laptop GPU. Doing
 * it once per docs build, and never again, is the difference between an
 * optional feature and one nobody waits for. The docs digest is the key, so a
 * new deploy recomputes and an unchanged one never does.
 */

const DATABASE = "jit-assistant";
const STORE = "vectors";

interface CachedVectors {
  version: string;
  dimensions: number;
  data: ArrayBuffer;
}

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    // a browser with storage disabled is not an error worth surfacing
    request.onerror = () => resolve(null);
  });
}

export async function readVectors(version: string): Promise<Float32Array[] | null> {
  const database = await open();
  if (!database) return null;

  try {
    const cached = await new Promise<CachedVectors | undefined>((resolve) => {
      const request = database.transaction(STORE, "readonly").objectStore(STORE).get("docs");
      request.onsuccess = () => resolve(request.result as CachedVectors | undefined);
      request.onerror = () => resolve(undefined);
    });

    if (!cached || cached.version !== version) return null;

    const flat = new Float32Array(cached.data);
    const vectors: Float32Array[] = [];
    for (let offset = 0; offset < flat.length; offset += cached.dimensions) {
      vectors.push(flat.subarray(offset, offset + cached.dimensions));
    }

    return vectors;
  } finally {
    database.close();
  }
}

export async function writeVectors(version: string, vectors: Float32Array[]): Promise<void> {
  const database = await open();
  if (!database || vectors.length === 0) return;

  const dimensions = vectors[0].length;
  const flat = new Float32Array(vectors.length * dimensions);
  for (const [index, vector] of vectors.entries()) flat.set(vector, index * dimensions);

  try {
    await new Promise<void>((resolve) => {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put({ version, dimensions, data: flat.buffer } satisfies CachedVectors, "docs");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
  } finally {
    database.close();
  }
}
