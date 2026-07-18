import type { LabCompilerFile } from "../compiler/worker-types.js";

export interface PublishedArtifact {
  readonly token: string;
  readonly hash: string;
  readonly files: number;
  readonly bytes: number;
}

export async function publishArtifact(
  files: readonly LabCompilerFile[],
  outputRoot: string
): Promise<PublishedArtifact> {
  const response = await fetch("/api/lab/artifacts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ files, outputRoot }),
  });
  const payload = (await response.json()) as Partial<PublishedArtifact> & { readonly error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Could not publish generated artifact");
  if (
    typeof payload.token !== "string" ||
    typeof payload.hash !== "string" ||
    typeof payload.files !== "number" ||
    typeof payload.bytes !== "number"
  ) {
    throw new Error("Artifact registry returned an invalid response");
  }
  return payload as PublishedArtifact;
}
