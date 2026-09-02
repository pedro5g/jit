/**
 * Putting the compiled knowledge on disk.
 *
 * Two rules, both about determinism. Keys are written in a fixed order and
 * arrays are pre-sorted by their producers, so two builds of the same tree
 * produce byte-identical files — which is what lets CI assert that the
 * committed artifacts are not stale (§67) by rebuilding and comparing rather
 * than by trusting a timestamp.
 *
 * And vectors are written as raw little-endian Float32, not JSON. A 384-wide
 * vector costs about 4.5 KB as JSON text and 1.5 KB as bytes, and there are
 * thousands of them; the JSON form also has to be parsed into an array of
 * arrays before it can be searched, which is the allocation the search was
 * supposed to avoid.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { ARTIFACTS } from "../../lib/copilot/config/artifacts";
import type { ApiSymbol } from "../../lib/copilot/core/entities/api-symbol";
import type { DocumentChunk } from "../../lib/copilot/core/entities/document-chunk";
import type { KnowledgeEntry } from "../../lib/copilot/core/entities/knowledge-entry";
import type { KnowledgeRelation } from "../../lib/copilot/core/entities/knowledge-relation";
import type { KnowledgeManifest } from "../../lib/copilot/core/entities/manifest";
import type { RouteEntry } from "../../lib/copilot/core/entities/route-entry";
import type { LexicalIndex } from "./indexes/lexical";

export interface WriteInput {
  outDir: string;
  manifest: KnowledgeManifest;
  entries: KnowledgeEntry[];
  chunks: DocumentChunk[];
  symbols: ApiSymbol[];
  routes: RouteEntry[];
  relations: KnowledgeRelation[];
  lexical: LexicalIndex;
  /** One per chunk, in chunk order, or null when the build skipped embeddings. */
  vectors: Float32Array[] | null;
}

/**
 * Packs every vector into one buffer.
 *
 * One buffer rather than one per chunk because the search reads all of them:
 * a single `Float32Array` over a single `ArrayBuffer` means the hot loop walks
 * contiguous memory with no pointer chasing, and the offset of chunk `i` is
 * `i * dimensions` — so no offset table is needed either.
 */
export function packVectors(vectors: readonly Float32Array[], dimensions: number): Buffer {
  const packed = new Float32Array(vectors.length * dimensions);

  for (const [index, vector] of vectors.entries()) {
    if (vector.length !== dimensions) {
      throw new Error(`vector ${index} has ${vector.length} dimensions, expected ${dimensions}`);
    }
    packed.set(vector, index * dimensions);
  }

  return Buffer.from(packed.buffer, packed.byteOffset, packed.byteLength);
}

/**
 * An entry as it is shipped — everything except the text.
 *
 * An entry's content is exactly the concatenation of its chunks, so writing
 * both means shipping the entire documentation twice: 156 KB gzipped of the
 * roughly 440 KB total, for bytes the reader already has. The loader rejoins
 * them on the way in, which costs one pass over an array it is parsing anyway.
 *
 * The join is lossless for the nine entries in ten that are a single chunk,
 * and normalizes runs of blank lines for the rest — which the chunker had
 * already done to them before they were split.
 */
export type WireKnowledgeEntry = Omit<KnowledgeEntry, "content">;

export function stripContent(entries: readonly KnowledgeEntry[]): WireKnowledgeEntry[] {
  return entries.map(({ content: _content, ...rest }) => rest);
}

/** Compact JSON wins here: ids compress well and a binary codec would add no measured value. */
export type WireKnowledgeEdge = readonly [
  KnowledgeRelation["to"],
  KnowledgeRelation["kind"],
  KnowledgeRelation["source"],
];
export type WireKnowledgeNode = readonly [KnowledgeRelation["from"], WireKnowledgeEdge[]];

export function packRelations(relations: readonly KnowledgeRelation[]): WireKnowledgeNode[] {
  const nodes = new Map<KnowledgeRelation["from"], WireKnowledgeEdge[]>();
  for (const relation of relations) {
    const edges = nodes.get(relation.from) ?? [];
    edges.push([relation.to, relation.kind, relation.source]);
    nodes.set(relation.from, edges);
  }
  return [...nodes];
}

async function writeJson(file: string, value: unknown): Promise<number> {
  const text = JSON.stringify(value);
  await fs.writeFile(file, text);
  return Buffer.byteLength(text);
}

export async function writeArtifacts(input: WriteInput): Promise<Record<string, number>> {
  await fs.mkdir(input.outDir, { recursive: true });

  const bytes: Record<string, number> = {};
  const at = (name: keyof typeof ARTIFACTS) => path.join(input.outDir, ARTIFACTS[name]);

  bytes[ARTIFACTS.knowledge] = await writeJson(at("knowledge"), stripContent(input.entries));
  bytes[ARTIFACTS.chunks] = await writeJson(at("chunks"), input.chunks);
  bytes[ARTIFACTS.symbols] = await writeJson(at("symbols"), input.symbols);
  bytes[ARTIFACTS.routes] = await writeJson(at("routes"), input.routes);
  bytes[ARTIFACTS.relations] = await writeJson(at("relations"), packRelations(input.relations));
  bytes[ARTIFACTS.lexical] = await writeJson(at("lexical"), input.lexical);

  if (input.vectors) {
    const packed = packVectors(input.vectors, input.manifest.embedding.dimensions);
    await fs.writeFile(at("vectors"), packed);
    bytes[ARTIFACTS.vectors] = packed.byteLength;
  } else {
    // A stale vectors file next to fresh chunks is the worst of both worlds:
    // the offsets still resolve and every result is wrong.
    await fs.rm(at("vectors"), { force: true });
  }

  // The manifest is written last and carries the sizes of everything else, so
  // a half-finished build cannot present itself as complete.
  const manifest: KnowledgeManifest = { ...input.manifest, bytes };
  bytes[ARTIFACTS.manifest] = await writeJson(at("manifest"), manifest);

  return bytes;
}
