import { NextResponse } from "next/server";
import { createStoredArtifact, getSigningIdentity, signReference } from "@/lib/lab/registry/protocol";
import { storeArtifact } from "@/lib/lab/registry/storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { readonly files?: unknown; readonly outputRoot?: unknown };
    if (!Array.isArray(body.files) || typeof body.outputRoot !== "string") {
      return NextResponse.json({ error: "files and outputRoot are required" }, { status: 400 });
    }

    const generated = createStoredArtifact(
      body.files as readonly { readonly path: string; readonly source: string }[],
      body.outputRoot
    );
    await storeArtifact(generated.hash, generated.bytes);

    const registry = registryOrigin(request);
    const identity = getSigningIdentity();
    const token = signReference(
      {
        hash: generated.hash,
        outputRoot: generated.artifact.outputRoot,
        registry,
      },
      identity
    );
    return NextResponse.json(
      {
        token,
        hash: generated.hash,
        files: generated.artifact.files.length,
        bytes: generated.artifact.files.reduce((total, file) => total + Buffer.byteLength(file.source), 0),
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not publish artifact" },
      { status: 400 }
    );
  }
}

function registryOrigin(request: Request): string {
  const configured = process.env.JIT_LAB_PUBLIC_ORIGIN;
  if (configured) return new URL(configured).origin;
  return new URL(request.url).origin;
}
