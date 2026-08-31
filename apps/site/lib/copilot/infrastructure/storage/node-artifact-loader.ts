/**
 * Artifacts read off disk.
 *
 * This exists so the entire retrieval stack can run with no browser and no
 * network: the eval suite, `knowledge:inspect` and the unit tests all use it,
 * and they exercise exactly the objects the browser will. §93's "question ->
 * retrieval -> expected symbol, without an LLM" is only cheap to run because
 * of this file.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { ARTIFACTS } from "../../config/artifacts";
import type { KnowledgeManifest } from "../../core/entities/manifest";
import { artifactUnavailable } from "../../core/errors/copilot-error";
import type { ArtifactLoaderPort } from "../../core/ports/artifact-loader";
import type { KnowledgeSource } from "../../core/repositories";
import { assertConsistent, hydrate, type RawArtifacts } from "./hydrate";

export class NodeArtifactLoader implements ArtifactLoaderPort {
  constructor(private readonly dir: string) {}

  private async json<T>(name: keyof typeof ARTIFACTS): Promise<T> {
    const file = path.join(this.dir, ARTIFACTS[name]);
    try {
      return JSON.parse(await fs.readFile(file, "utf8")) as T;
    } catch (error) {
      throw artifactUnavailable(`${ARTIFACTS[name]} (run pnpm knowledge:build)`, error);
    }
  }

  loadManifest(): Promise<KnowledgeManifest> {
    return this.json<KnowledgeManifest>("manifest");
  }

  async loadSource(manifest: KnowledgeManifest): Promise<KnowledgeSource> {
    const [entries, chunks, symbols, routes] = await Promise.all([
      this.json<RawArtifacts["entries"]>("knowledge"),
      this.json<RawArtifacts["chunks"]>("chunks"),
      this.json<RawArtifacts["symbols"]>("symbols"),
      this.json<RawArtifacts["routes"]>("routes"),
    ]);

    const source = hydrate({ manifest, entries, chunks, symbols, routes });
    assertConsistent(source);
    return source;
  }

  async loadVectors(manifest: KnowledgeManifest): Promise<Float32Array | null> {
    if (manifest.counts.vectors === 0) return null;

    try {
      const buffer = await fs.readFile(path.join(this.dir, ARTIFACTS.vectors));
      // The buffer may be a view into a pool, so the offset matters.
      return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
    } catch {
      // §78: no vectors is a capability level, not a failure. Lexical and
      // symbol retrieval answer most questions without them.
      return null;
    }
  }

  /** The lexical index, which is not part of `KnowledgeSource`. */
  loadLexical() {
    return this.json<import("../retrieval/lexical-repository").LexicalIndexDocument>("lexical");
  }
}
