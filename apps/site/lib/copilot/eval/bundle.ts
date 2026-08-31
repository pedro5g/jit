/**
 * A run, as one file, so a browser can hand it over — §PART 26.
 *
 * The on-disk shape is a directory of four files, and it stays that way: every
 * tool that reads a run reads that. But a page cannot write a directory, and
 * four separate downloads is four chances to end up with three of them. So the
 * browser emits one JSON envelope and `knowledge:import` unpacks it into the
 * directory — the file is transport, never a second format.
 *
 * Which is why this parses rather than casts. A bundle arrives through a
 * download folder, and a truncated or hand-edited one that unpacked silently
 * would produce a run directory whose manifest disagrees with its rows, which
 * is exactly the unfalsifiable artifact the manifest exists to prevent.
 */
import type { CaseRecord, ContextRecord, ResponseRecord, RunArtifacts, RunManifest } from "./artifacts";

export const BUNDLE_KIND = "copilot-run";
export const BUNDLE_VERSION = 1;

export interface RunBundle extends RunArtifacts {
  kind: typeof BUNDLE_KIND;
  version: number;
}

export function packBundle(artifacts: RunArtifacts): RunBundle {
  return { kind: BUNDLE_KIND, version: BUNDLE_VERSION, ...artifacts };
}

/** `2026-08-30T2118-D-qwen3.5-0.8b.json` — the run id, so a download is named. */
export function bundleFileName(manifest: RunManifest): string {
  return `${manifest.runId}.json`;
}

function fail(what: string): never {
  throw new Error(`This is not a usable copilot run bundle: ${what}.`);
}

export function parseBundle(text: string): RunArtifacts {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`it is not JSON (${error instanceof Error ? error.message : "unknown error"})`);
  }

  if (!parsed || typeof parsed !== "object") fail("it is not an object");
  const bundle = parsed as Partial<RunBundle>;

  if (bundle.kind !== BUNDLE_KIND) fail(`its kind is ${JSON.stringify(bundle.kind)}, not ${BUNDLE_KIND}`);
  if (bundle.version !== BUNDLE_VERSION)
    fail(`it is version ${bundle.version}, and this build reads ${BUNDLE_VERSION}`);

  const manifest = bundle.manifest;
  if (!manifest?.runId) fail("it has no manifest");

  const cases = bundle.cases ?? fail("it has no cases");
  const contexts = bundle.contexts ?? fail("it has no contexts");
  const responses = bundle.responses ?? fail("it has no responses");

  if (cases.length !== responses.length || contexts.length !== responses.length) {
    fail(`its streams disagree (${cases.length} cases, ${contexts.length} contexts, ${responses.length} responses)`);
  }

  // The manifest's own count is what a report prints, so a bundle whose
  // manifest outlived an interrupted run must not import as if it were whole.
  if (manifest.cases !== responses.length) {
    fail(`its manifest claims ${manifest.cases} cases and it carries ${responses.length}`);
  }

  return {
    manifest,
    cases: cases as CaseRecord[],
    contexts: contexts as ContextRecord[],
    responses: responses as ResponseRecord[],
  };
}
