import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign,
  verify,
} from "node:crypto";
import type { LabCompilerFile } from "../compiler/worker-types.js";

export const REFERENCE_PREFIX = "jlr1_";
export const MAX_ARTIFACT_FILES = 128;
export const MAX_ARTIFACT_FILE_BYTES = 512 * 1024;
export const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;

export interface StoredArtifact {
  readonly version: 1;
  readonly outputRoot: string;
  readonly files: readonly LabCompilerFile[];
}

export interface ArtifactReference {
  readonly version: 1;
  readonly hash: string;
  readonly outputRoot: string;
  readonly registry: string;
  readonly keyId: string;
}

interface EncodedArtifactReference {
  readonly v: 1;
  readonly h: string;
  readonly o: string;
  readonly r: string;
  readonly k: string;
}

export interface SigningIdentity {
  readonly keyId: string;
  readonly publicKey: string;
  readonly privateKey: KeyObject;
}

let developmentIdentity: SigningIdentity | undefined;

export function createStoredArtifact(
  files: readonly LabCompilerFile[],
  outputRoot: string
): { readonly artifact: StoredArtifact; readonly bytes: Uint8Array; readonly hash: string } {
  validateOutputRoot(outputRoot);
  if (files.length === 0 || files.length > MAX_ARTIFACT_FILES) {
    throw new Error(`Artifact must contain between 1 and ${MAX_ARTIFACT_FILES} files`);
  }

  let totalBytes = 0;
  const normalized = files
    .map((file) => {
      validateRelativePath(file.path);
      const fileBytes = Buffer.byteLength(file.source);
      if (fileBytes > MAX_ARTIFACT_FILE_BYTES) {
        throw new Error(`${file.path} exceeds the ${MAX_ARTIFACT_FILE_BYTES} byte limit`);
      }
      totalBytes += fileBytes;
      return { path: file.path, source: file.source };
    })
    .sort((left, right) => left.path.localeCompare(right.path));

  if (new Set(normalized.map((file) => file.path)).size !== normalized.length) {
    throw new Error("Artifact paths must be unique");
  }
  if (totalBytes > MAX_ARTIFACT_BYTES) {
    throw new Error(`Artifact exceeds the ${MAX_ARTIFACT_BYTES} byte limit`);
  }

  const artifact: StoredArtifact = { version: 1, outputRoot, files: normalized };
  const bytes = Buffer.from(JSON.stringify(artifact));
  return {
    artifact,
    bytes,
    hash: createHash("sha256").update(bytes).digest("base64url"),
  };
}

export function parseStoredArtifact(
  bytes: Uint8Array,
  expectedHash?: string
): { readonly artifact: StoredArtifact; readonly hash: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new Error("Stored artifact is not valid JSON");
  }
  if (!isStoredArtifact(parsed)) throw new Error("Stored artifact has an invalid shape");

  const canonical = createStoredArtifact(parsed.files, parsed.outputRoot);
  if (!Buffer.from(bytes).equals(Buffer.from(canonical.bytes))) {
    throw new Error("Stored artifact is not canonical");
  }
  if (expectedHash !== undefined && canonical.hash !== expectedHash) {
    throw new Error("Stored artifact hash does not match its reference");
  }
  return { artifact: canonical.artifact, hash: canonical.hash };
}

export function signReference(
  reference: Omit<ArtifactReference, "version" | "keyId">,
  identity: SigningIdentity
): string {
  const payload: ArtifactReference = {
    version: 1,
    hash: reference.hash,
    outputRoot: reference.outputRoot,
    registry: normalizeRegistry(reference.registry),
    keyId: identity.keyId,
  };
  validateReference(payload);
  const encoded: EncodedArtifactReference = {
    v: payload.version,
    h: payload.hash,
    o: payload.outputRoot,
    r: payload.registry,
    k: payload.keyId,
  };
  const encodedPayload = Buffer.from(JSON.stringify(encoded)).toString("base64url");
  const signature = sign(null, Buffer.from(encodedPayload), identity.privateKey).toString("base64url");
  return `${REFERENCE_PREFIX}${encodedPayload}.${signature}`;
}

export function parseReference(token: string): {
  readonly reference: ArtifactReference;
  readonly encodedPayload: string;
  readonly signature: Uint8Array;
} {
  if (!token.startsWith(REFERENCE_PREFIX)) throw new Error(`Token must start with ${REFERENCE_PREFIX}`);
  const parts = token.slice(REFERENCE_PREFIX.length).split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("Malformed artifact reference");

  let encoded: unknown;
  try {
    encoded = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    throw new Error("Artifact reference payload is invalid");
  }
  if (!isEncodedArtifactReference(encoded)) throw new Error("Artifact reference has an invalid shape");
  const reference: ArtifactReference = {
    version: encoded.v,
    hash: encoded.h,
    outputRoot: encoded.o,
    registry: encoded.r,
    keyId: encoded.k,
  };
  validateReference(reference);

  return {
    reference,
    encodedPayload: parts[0],
    signature: Buffer.from(parts[1], "base64url"),
  };
}

export function verifyReference(token: string, publicKey: KeyObject): ArtifactReference {
  const parsed = parseReference(token);
  if (!verify(null, Buffer.from(parsed.encodedPayload), publicKey, parsed.signature)) {
    throw new Error("Artifact reference signature is invalid");
  }
  return parsed.reference;
}

export function getSigningIdentity(): SigningIdentity {
  const configured = process.env.JIT_LAB_SIGNING_PRIVATE_KEY;
  if (configured) {
    return identityFromPrivateKey(configured.replaceAll("\\n", "\n"));
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("JIT_LAB_SIGNING_PRIVATE_KEY is required in production");
  }
  developmentIdentity ??= identityFromPrivateKey(generateKeyPairSync("ed25519").privateKey);
  return developmentIdentity;
}

export function identityFromPrivateKey(privateKey: string | KeyObject): SigningIdentity {
  const material = typeof privateKey === "string" ? privateKey : privateKey.export({ format: "pem", type: "pkcs8" });
  const key = createPrivateKey(material);
  const publicKey = createPublicKey(material);
  const encodedPublicKey = publicKey.export({ format: "der", type: "spki" });
  return {
    privateKey: key,
    publicKey: encodedPublicKey.toString("base64url"),
    keyId: createHash("sha256").update(encodedPublicKey).digest("base64url").slice(0, 12),
  };
}

export function publicKeyFromBase64(value: string): KeyObject {
  return createPublicKey({
    key: Buffer.from(value, "base64url"),
    format: "der",
    type: "spki",
  });
}

function isStoredArtifact(value: unknown): value is StoredArtifact {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<StoredArtifact>;
  return (
    candidate.version === 1 &&
    typeof candidate.outputRoot === "string" &&
    Array.isArray(candidate.files) &&
    candidate.files.every(
      (file) =>
        file !== null &&
        typeof file === "object" &&
        typeof (file as LabCompilerFile).path === "string" &&
        typeof (file as LabCompilerFile).source === "string"
    )
  );
}

function isEncodedArtifactReference(value: unknown): value is EncodedArtifactReference {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<EncodedArtifactReference>;
  return (
    candidate.v === 1 &&
    typeof candidate.h === "string" &&
    typeof candidate.o === "string" &&
    typeof candidate.r === "string" &&
    typeof candidate.k === "string"
  );
}

function validateReference(reference: ArtifactReference): void {
  if (!/^[A-Za-z0-9_-]{43}$/.test(reference.hash)) throw new Error("Artifact hash is invalid");
  if (!/^[A-Za-z0-9_-]{12}$/.test(reference.keyId)) throw new Error("Signing key identifier is invalid");
  validateOutputRoot(reference.outputRoot);
  normalizeRegistry(reference.registry);
}

function validateOutputRoot(path: string): void {
  validateRelativePath(path);
  if (path.length > 240) throw new Error("Output directory is too long");
}

function validateRelativePath(path: string): void {
  if (
    path.length === 0 ||
    path.length > 240 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Unsafe relative path: ${path}`);
  }
}

function normalizeRegistry(value: string): string {
  const url = new URL(value);
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) {
    throw new Error("Registry must use HTTPS");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Registry must be a bare origin");
  }
  return url.origin;
}
