/**
 * What the compiler is allowed to read.
 *
 * Explicit rather than "everything under content/": the build has to be
 * reproducible, and a stray `.mdx` left in a scratch folder must not silently
 * become documentation the ghost cites. Files come back sorted so two runs on
 * the same tree produce byte-identical artifacts — which is what makes
 * `contentHash` mean anything.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export interface SourceFile {
  /** Absolute, for reading. */
  absolute: string;
  /** Relative to the content root, which is what the route id is derived from. */
  relative: string;
}

export async function discoverDocs(contentDir: string): Promise<SourceFile[]> {
  const found: SourceFile[] = [];

  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.name.endsWith(".mdx")) {
        found.push({ absolute, relative: path.relative(contentDir, absolute).replaceAll(path.sep, "/") });
      }
    }
  }

  await walk(contentDir);
  return found.sort((left, right) => left.relative.localeCompare(right.relative));
}
