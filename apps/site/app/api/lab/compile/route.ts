import { compileLabArtifact } from "@/lib/lab/compile";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const source = await request.text();
    if (new TextEncoder().encode(source).byteLength > 64 * 1024) {
      return Response.json({ error: "request exceeds 64 KiB" }, { status: 413 });
    }
    const input: unknown = JSON.parse(source);
    return Response.json(compileLabArtifact(input));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "unable to compile artifact" },
      { status: 400 }
    );
  }
}
