/**
 * The incremental half of the build.
 *
 * Embedding 1,600 chunks takes minutes; embedding the four that changed takes
 * a second. §97's completion criterion is exactly that — editing one document
 * recomputes only its own chunks — and the whole mechanism is one lookup by
 * content hash.
 *
 * The cache is keyed by `embeddingHash`, which folds in the model id and the
 * pipeline version. That gets two properties for free: two chunks with
 * identical text share one vector, and changing the model invalidates
 * everything without anyone having to remember to clear a directory. A cache
 * that survives a model change is not a stale cache, it is a wrong one.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fromBuffer, toBuffer } from "./binary";

export class EmbeddingCache {
  private hits = 0;
  private misses = 0;
  /** Hashes written this run, so one build never writes the same file twice. */
  private readonly written = new Set<string>();

  constructor(
    private readonly dir: string,
    private readonly dimensions: number
  ) {}

  async prepare(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  private fileFor(hash: string): string {
    // Two levels of fan-out. A few thousand files in one directory is fine on
    // ext4 and miserable on anything syncing them; the prefix costs nothing.
    return path.join(this.dir, hash.slice(0, 2), `${hash}.bin`);
  }

  async read(hash: string): Promise<Float32Array | null> {
    try {
      const vector = fromBuffer(await fs.readFile(this.fileFor(hash)), this.dimensions);
      this.hits += 1;
      return vector;
    } catch {
      // A missing file is the ordinary case. A corrupt or wrong-sized one is
      // treated identically on purpose: recomputing is cheap and correct,
      // while reading a truncated vector is cheap and wrong.
      this.misses += 1;
      return null;
    }
  }

  async write(hash: string, vector: Float32Array): Promise<void> {
    if (this.written.has(hash)) return;
    this.written.add(hash);

    const file = this.fileFor(hash);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, toBuffer(vector));
  }

  get stats() {
    return { hits: this.hits, misses: this.misses };
  }

  /**
   * Removes cached vectors no live chunk claims.
   *
   * Without this the directory only grows: every edited paragraph leaves its
   * old vector behind forever. Run at the end of a full build, when the set of
   * live hashes is known to be complete — running it after a partial build
   * would delete vectors that are merely not needed this time.
   */
  async prune(live: ReadonlySet<string>): Promise<number> {
    let removed = 0;

    for (const bucket of await fs.readdir(this.dir).catch(() => [])) {
      const bucketDir = path.join(this.dir, bucket);
      if (!(await fs.stat(bucketDir)).isDirectory()) continue;

      for (const name of await fs.readdir(bucketDir)) {
        const hash = name.replace(/\.bin$/, "");
        if (live.has(hash)) continue;

        await fs.rm(path.join(bucketDir, name));
        removed += 1;
      }
    }

    return removed;
  }
}
