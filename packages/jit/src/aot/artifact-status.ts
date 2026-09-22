import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { stableJson } from "./artifact-json.js";
import type { ArtifactManifestV1, ArtifactStatusResult, CompilationReceipt } from "./artifact-manifest.js";
import { isArtifactManifest, isCompilationReceipt } from "./artifact-manifest-validation.js";
import { sha256 } from "./hash.js";

/** Verifies the sidecars and every declared file without loading generated code. */
export function inspectArtifactStatus(
  outputDir: string,
  manifestName = "jit.manifest.json",
  receiptName = "jit.receipt.json"
): ArtifactStatusResult {
  const manifestResult = readManifest(outputDir, manifestName);
  if (manifestResult.result) return manifestResult.result;
  const manifest = manifestResult.value;
  if (manifest.ownership === "detached") return detachedStatus(manifest);

  const receiptResult = readReceipt(outputDir, receiptName, manifest);
  if (receiptResult.result) return receiptResult.result;
  const receipt = receiptResult.value;
  return verifyManagedArtifact(outputDir, manifest, receipt);
}

type MetadataRead<T> =
  | { readonly value: T; readonly result: undefined }
  | { readonly value: undefined; readonly result: ArtifactStatusResult };

function readManifest(outputDir: string, name: string): MetadataRead<ArtifactManifestV1> {
  try {
    const path = safePath(outputDir, name);
    if (!existsSync(path)) return { value: undefined, result: { status: "missing", reason: "manifest is missing" } };
    const value = readJson<unknown>(path);
    if (!isArtifactManifest(value)) throw new Error("manifest shape is invalid");
    return { value, result: undefined };
  } catch (error) {
    return { value: undefined, result: { status: "stale", reason: `manifest is invalid: ${errorMessage(error)}` } };
  }
}

function readReceipt(outputDir: string, name: string, manifest: ArtifactManifestV1): MetadataRead<CompilationReceipt> {
  try {
    const path = safePath(outputDir, name);
    if (!existsSync(path))
      return { value: undefined, result: { status: "stale", manifest, reason: "receipt is missing" } };
    const value = readJson<unknown>(path);
    if (!isCompilationReceipt(value)) throw new Error("receipt shape is invalid");
    return { value, result: undefined };
  } catch (error) {
    return {
      value: undefined,
      result: { status: "stale", manifest, reason: `receipt is invalid: ${errorMessage(error)}` },
    };
  }
}

function detachedStatus(manifest: ArtifactManifestV1): ArtifactStatusResult {
  return { status: "detached", manifest, files: manifest.files.map((file) => file.path) };
}

function verifyManagedArtifact(
  outputDir: string,
  manifest: ArtifactManifestV1,
  receipt: CompilationReceipt
): ArtifactStatusResult {
  try {
    const fileResult = verifyFiles(outputDir, manifest, receipt);
    if (fileResult) return fileResult;
    const digestResult = verifyManifestDigests(manifest, receipt);
    if (digestResult) return digestResult;
  } catch (error) {
    return { status: "stale", manifest, receipt, reason: `artifact metadata is invalid: ${errorMessage(error)}` };
  }
  return { status: "clean", manifest, receipt, files: manifest.files.map((file) => file.path) };
}

function verifyFiles(
  outputDir: string,
  manifest: ArtifactManifestV1,
  receipt: CompilationReceipt
): ArtifactStatusResult | undefined {
  const changed: string[] = [];
  for (const file of manifest.files) {
    const path = safePath(outputDir, file.path);
    if (!existsSync(path))
      return { status: "missing", manifest, receipt, files: [file.path], reason: "declared file is missing" };
    if (statSync(path).size !== file.bytes || sha256(readFileSync(path)) !== file.hash) changed.push(file.path);
  }
  const generatedFiles = new Set(manifest.files.map((file) => file.path));
  const extras = findGeneratedExtras(outputDir, "", generatedFiles);
  const files = [...changed, ...extras].sort(compareText);
  return files.length > 0
    ? {
        status: "modified",
        manifest,
        receipt,
        files,
        reason: extras.length > 0 ? "generated file is not declared in the manifest" : "declared file hash changed",
      }
    : undefined;
}

function findGeneratedExtras(directory: string, relativeDirectory: string, declared: ReadonlySet<string>): string[] {
  let entries: readonly import("node:fs").Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const extras: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    const relativePath = relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) {
      extras.push(...findGeneratedExtras(path, relativePath, declared));
    } else if (!declared.has(relativePath) && isGeneratedSource(path)) {
      extras.push(relativePath);
    }
  }
  return extras;
}

function isGeneratedSource(path: string): boolean {
  try {
    return readFileSync(path, "utf8").startsWith("// Generated by jit — do not edit.");
  } catch {
    return false;
  }
}

function verifyManifestDigests(
  manifest: ArtifactManifestV1,
  receipt: CompilationReceipt
): ArtifactStatusResult | undefined {
  const artifactDigest = sha256(stableJson(manifest.files.map(({ path, hash, bytes }) => ({ path, hash, bytes }))));
  const manifestDigest = sha256(stableJson({ ...manifest, manifestDigest: "" }));
  if (artifactDigest !== manifest.artifactDigest || manifestDigest !== manifest.manifestDigest)
    return { status: "stale", manifest, receipt, reason: "manifest digest does not match its contents" };
  if (!receiptMatchesManifest(receipt, manifest))
    return { status: "stale", manifest, receipt, reason: "receipt does not match the manifest" };
  return undefined;
}

function receiptMatchesManifest(receipt: CompilationReceipt, manifest: ArtifactManifestV1): boolean {
  return (
    receipt.compilerVersion === manifest.compiler.version &&
    receipt.declarationDigest === manifest.declarationDigest &&
    receipt.manifestDigest === manifest.manifestDigest &&
    receipt.artifactDigest === manifest.artifactDigest &&
    receipt.programDigest === manifest.programDigest &&
    receipt.files === manifest.files.length &&
    receipt.symbols === manifest.symbols.length
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safePath(root: string, path: string): string {
  if (isAbsolute(path)) throw new Error(`Artifact path must be relative: ${path}`);
  const resolved = resolve(root, path);
  const rel = relative(resolve(root), resolved);
  if (rel === ".." || rel.startsWith("..\\") || rel.startsWith("../"))
    throw new Error(`Artifact path escapes output directory: ${path}`);
  return resolved;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
