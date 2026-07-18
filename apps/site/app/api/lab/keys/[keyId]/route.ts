import { NextResponse } from "next/server";
import { getSigningIdentity } from "@/lib/lab/registry/protocol";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { readonly params: Promise<{ readonly keyId: string }> }) {
  const { keyId } = await context.params;
  const identity = getSigningIdentity();
  if (keyId !== identity.keyId) {
    return NextResponse.json({ error: "Signing key not found" }, { status: 404 });
  }
  return NextResponse.json(
    {
      algorithm: "Ed25519",
      keyId: identity.keyId,
      publicKey: identity.publicKey,
    },
    { headers: { "cache-control": "public, max-age=3600" } }
  );
}
