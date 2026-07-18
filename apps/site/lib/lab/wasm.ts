"use client";

export interface ArtifactFileInput {
  readonly path: string;
  readonly source: string;
}

export interface ArtifactFileReport {
  readonly path: string;
  readonly bytes: number;
  readonly executable: boolean;
}

export interface ArtifactReport {
  readonly schemaVersion: number;
  readonly protocolVersion: number;
  readonly authenticated: boolean;
  readonly contentDigest: string;
  readonly envelopeDigest: string;
  readonly compression: string;
  readonly entries: number;
  readonly originalBytes: number;
  readonly storedBytes: number;
  readonly dictionaryBytes: number;
  readonly suggestedPath?: string;
  readonly files: readonly ArtifactFileReport[];
}

export interface PackedArtifact {
  readonly token: string;
  readonly report: ArtifactReport;
}

interface ArtifactWasm {
  default(): Promise<unknown>;
  pack_typescript(files: readonly ArtifactFileInput[], outputRoot: string): PackedArtifact;
  inspect_token(token: string): ArtifactReport;
}

let modulePromise: Promise<ArtifactWasm> | undefined;

async function loadArtifactWasm(): Promise<ArtifactWasm> {
  modulePromise ??= import("./generated/jit_artifact.js").then(async (module: unknown) => {
    if (
      module === null ||
      typeof module !== "object" ||
      !("default" in module) ||
      typeof module.default !== "function" ||
      !("pack_typescript" in module) ||
      typeof module.pack_typescript !== "function" ||
      !("inspect_token" in module) ||
      typeof module.inspect_token !== "function"
    ) {
      throw new Error("artifact WASM module has an incompatible interface");
    }
    const artifactModule = module as ArtifactWasm;
    await artifactModule.default();
    return artifactModule;
  });

  return modulePromise;
}

export async function packArtifact(files: readonly ArtifactFileInput[], outputRoot: string): Promise<PackedArtifact> {
  const module = await loadArtifactWasm();
  return module.pack_typescript(files, outputRoot);
}

export async function inspectArtifact(token: string): Promise<ArtifactReport> {
  const module = await loadArtifactWasm();
  return module.inspect_token(token);
}
