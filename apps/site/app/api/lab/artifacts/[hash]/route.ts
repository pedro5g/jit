import { NextResponse } from "next/server";
import { parseStoredArtifact } from "@/lib/lab/registry/protocol";
import { loadArtifact } from "@/lib/lab/registry/storage";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { readonly params: Promise<{ readonly hash: string }> }) {
  try {
    const { hash } = await context.params;
    const bytes = await loadArtifact(hash);
    if (!bytes) return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    parseStoredArtifact(bytes, hash);
    const responseBytes = new Uint8Array(bytes.byteLength);
    responseBytes.set(bytes);
    return new Response(responseBytes.buffer, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read artifact" },
      { status: 400 }
    );
  }
}
