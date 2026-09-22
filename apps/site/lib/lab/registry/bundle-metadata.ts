import {
  type ArtifactBundleContribution,
  type ArtifactBundleFile,
  createArtifactBundleMetadata,
} from "../../../../../packages/jit/src/aot/artifact-bundle.js";
import type { ArtifactManifestV1, CompilationReceipt } from "../../../../../packages/jit/src/aot/artifact-manifest.js";
import { sha256 } from "../../../../../packages/jit/src/aot/hash.js";
import type { LabCompilerFile } from "../compiler/worker-types.js";

export interface LabBundleUnit {
  readonly key: string;
  readonly result: {
    readonly manifest: ArtifactManifestV1;
    readonly receipt: CompilationReceipt;
  };
  readonly fileMap: Readonly<Record<string, string>>;
}

export interface LabBundleMetadata {
  readonly manifest: ArtifactManifestV1;
  readonly receipt: CompilationReceipt;
}

/** Builds one hash-bound project manifest from the Lab's per-file compiler units. */
export function createLabBundleMetadata(
  units: readonly LabBundleUnit[],
  files: readonly LabCompilerFile[],
  format: "ts" | "js"
): LabBundleMetadata {
  const manifestFiles: ArtifactBundleFile[] = files.map((file) => ({
    path: file.path,
    hash: sha256(file.source),
    bytes: new TextEncoder().encode(file.source).byteLength,
    exports: [],
    imports: [],
  }));
  const contributions: ArtifactBundleContribution[] = units.map((unit) => ({
    key: unit.key,
    manifest: unit.result.manifest,
    receipt: unit.result.receipt,
    fileMap: unit.fileMap,
  }));
  return createArtifactBundleMetadata(contributions, manifestFiles, {
    ownership: "managed",
    format,
    naming: "compact",
  });
}

/** Materializes metadata as ordinary bundle files so jit1_/jlr1_ bind it. */
export function metadataFiles(metadata: LabBundleMetadata): readonly LabCompilerFile[] {
  return [
    { path: "jit.manifest.json", source: `${JSON.stringify(metadata.manifest, null, 2)}\n` },
    { path: "jit.receipt.json", source: `${JSON.stringify(metadata.receipt, null, 2)}\n` },
  ];
}
