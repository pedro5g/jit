import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { get, put } from "@vercel/blob";

const BLOB_PREFIX = "jit-lab/v1";
const LOCAL_STORE = ".jit-lab-store";

export async function storeArtifact(hash: string, bytes: Uint8Array): Promise<void> {
  const pathname = blobPath(hash);
  if (usesBlob()) {
    await put(pathname, Buffer.from(bytes), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return;
  }

  const destination = localPath(hash);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, destination);
}

export async function loadArtifact(hash: string): Promise<Uint8Array | null> {
  if (usesBlob()) {
    const result = await get(blobPath(hash), { access: "private" });
    if (!result?.stream) return null;
    return new Uint8Array(await new Response(result.stream).arrayBuffer());
  }

  try {
    return await readFile(localPath(hash));
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

function usesBlob(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      (process.env.VERCEL_OIDC_TOKEN && (process.env.BLOB_STORE_ID || process.env.VERCEL_BLOB_STORE_ID))
  );
}

function blobPath(hash: string): string {
  validateHash(hash);
  return `${BLOB_PREFIX}/${hash}.json`;
}

function localPath(hash: string): string {
  validateHash(hash);
  return path.join(process.cwd(), LOCAL_STORE, `${hash}.json`);
}

function validateHash(hash: string): void {
  if (!/^[A-Za-z0-9_-]{43}$/.test(hash)) throw new Error("Artifact hash is invalid");
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
