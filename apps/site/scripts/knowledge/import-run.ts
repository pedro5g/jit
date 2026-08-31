/**
 * `pnpm knowledge:import <bundle.json>` — a browser run, put where runs live.
 *
 * §PART 26's browser benchmark ends with a download, because a page cannot
 * write a directory. This is the other half: the envelope becomes the same
 * four files every other run is made of, so `knowledge:rescore` reads it with
 * no new code and the report renderer prints it with no new rows.
 *
 * It refuses more than it accepts. A bundle whose manifest disagrees with its
 * rows, or that would overwrite a run already on disk, is a way to end up with
 * a directory nobody can trust — and the whole point of the manifest is that a
 * run six weeks old still explains itself.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { ARTIFACT_DIR } from "../../lib/copilot/config/artifacts";
import type { KnowledgeManifest } from "../../lib/copilot/core/entities/manifest";
import { toJsonl } from "../../lib/copilot/eval/artifacts";
import { parseBundle } from "../../lib/copilot/eval/bundle";

const siteDir = path.resolve(import.meta.dirname, "../..");
const runsDir = path.join(siteDir, ".eval/copilot/runs");

const files = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
const force = process.argv.includes("--force");

if (files.length === 0) {
  console.error("usage: pnpm knowledge:import <bundle.json> [more.json ...] [--force]");
  process.exit(1);
}

/** The build the artifacts on disk came from, to check a run against. */
const local = JSON.parse(
  await fs.readFile(path.join(siteDir, "public", ARTIFACT_DIR, "manifest.json"), "utf8").catch(() => "null")
) as KnowledgeManifest | null;

for (const file of files) {
  const artifacts = parseBundle(await fs.readFile(path.resolve(file), "utf8"));
  const { manifest } = artifacts;
  const dir = path.join(runsDir, manifest.runId);

  const exists = await fs
    .stat(dir)
    .then(() => true)
    .catch(() => false);

  if (exists && !force) {
    console.error(`  ${manifest.runId} is already imported — pass --force to replace it`);
    process.exitCode = 1;
    continue;
  }

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  await fs.writeFile(path.join(dir, "cases.jsonl"), toJsonl(artifacts.cases));
  await fs.writeFile(path.join(dir, "contexts.jsonl"), toJsonl(artifacts.contexts));
  await fs.writeFile(path.join(dir, "responses.jsonl"), toJsonl(artifacts.responses));

  console.log(`  ${manifest.configLabel} -> ${path.relative(siteDir, dir)} (${manifest.cases} cases)`);

  /**
   * The comparison's one precondition, checked out loud.
   *
   * A browser run against a different knowledge build is not a comparison, and
   * the hash is what proves it. This warns rather than refuses: the run is
   * still a real measurement of that build, and deleting it would be worse
   * than knowing it cannot be put beside today's table.
   */
  if (local && local.contentHash !== manifest.knowledge.contentHash) {
    console.warn(
      `    warning: built from knowledge ${manifest.knowledge.contentHash.slice(0, 8)}, ` +
        `and this checkout ships ${local.contentHash.slice(0, 8)} — not comparable with runs from this build`
    );
  }
}

console.log("\n  next: pnpm knowledge:rescore\n");
