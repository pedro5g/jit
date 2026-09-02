/**
 * Artifacts fetched from the site that ships them.
 *
 * The browser half of `ArtifactLoaderPort`, and deliberately the thinnest one:
 * the URLs come from `config/artifacts`, so the path the build writes and the
 * path the browser asks for cannot drift, and hydration is the same function
 * the Node loader calls. What differs between the two runtimes is `fetch` and
 * `readFile`. Nothing else is allowed to.
 *
 * Vectors are a capability, not a requirement (§78). A build that shipped none
 * — or a `vectors.bin` a proxy declined to serve — degrades to lexical and
 * symbol retrieval rather than failing to load.
 */
import { ARTIFACT_BASE, ARTIFACTS, type ArtifactName } from "../../config/artifacts";
import type { KnowledgeRelation } from "../../core/entities/knowledge-relation";
import type { KnowledgeManifest } from "../../core/entities/manifest";
import { artifactUnavailable } from "../../core/errors/copilot-error";
import type { KnowledgeSource } from "../../core/repositories";
import type { LexicalCapableLoader } from "../knowledge-engine";
import type { LexicalIndexDocument } from "../retrieval/lexical-repository";
import { assertConsistent, hydrate, hydrateRelations, type RawArtifacts, type WireKnowledgeNode } from "./hydrate";

export class FetchArtifactLoader implements LexicalCapableLoader {
  constructor(
    private readonly base: string = ARTIFACT_BASE,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args)
  ) {}

  private url(name: ArtifactName): string {
    return `${this.base}/${ARTIFACTS[name]}`;
  }

  private async json<T>(name: ArtifactName): Promise<T> {
    try {
      const response = await this.fetchImpl(this.url(name));
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return (await response.json()) as T;
    } catch (error) {
      throw artifactUnavailable(ARTIFACTS[name], error);
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
      const response = await this.fetchImpl(this.url("vectors"));
      if (!response.ok) return null;
      return new Float32Array(await response.arrayBuffer());
    } catch {
      return null;
    }
  }

  async loadRelations(_manifest: KnowledgeManifest): Promise<KnowledgeRelation[]> {
    return hydrateRelations(await this.json<WireKnowledgeNode[]>("relations"));
  }

  loadLexical(): Promise<LexicalIndexDocument> {
    return this.json<LexicalIndexDocument>("lexical");
  }
}
