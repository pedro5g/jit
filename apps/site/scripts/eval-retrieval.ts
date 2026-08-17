/**
 * Scorecard for the ghost's retrieval and question understanding.
 *
 * Run from apps/site while iterating:
 *   pnpm eval:ghost
 *   pnpm eval:ghost --verbose
 *
 * The vitest suite pins these same numbers as a floor, through the same judge;
 * this prints the per-question detail needed to move them.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { GOLD } from "../lib/assistant/eval/gold";
import { judge, score } from "../lib/assistant/eval/judge";
import { DocsRetriever } from "../lib/assistant/retrieval";
import type { DocsIndex } from "../lib/assistant/types";

const indexPath = path.resolve(import.meta.dirname, "../public/assistant/docs-index.json");
const index = JSON.parse(readFileSync(indexPath, "utf8")) as DocsIndex;
const retriever = new DocsRetriever(index);

const verbose = process.argv.includes("--verbose");
const verdicts = GOLD.map((gold) => judge(gold, retriever, index));
const summary = score(verdicts);
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

for (const verdict of verdicts) {
  const passed = verdict.first && verdict.inContext && verdict.clean && verdict.concepts;
  if (passed && !verbose) continue;

  const flags = [
    verdict.first ? "  " : "✗1",
    verdict.inContext ? "  " : "✗C",
    verdict.clean ? "  " : "✗F",
    verdict.concepts ? "  " : "✗G",
  ].join(" ");

  console.log(`${flags}  ${verdict.gold.question}`);
  console.log(`        got: ${verdict.ranked.slice(0, 3).join(" | ") || "(nothing)"}`);
  if (verdict.gold.best) console.log(`        want first: ${verdict.gold.best.join(" | ")}`);
  if (verdict.missingConcepts.length) console.log(`        missing concepts: ${verdict.missingConcepts.join(", ")}`);
}

console.log(`\n${"─".repeat(60)}`);
console.log(`questions          ${summary.total}`);
console.log(`ranked first       ${percent(summary.first)}`);
console.log(`answer in context  ${percent(summary.inContext)}`);
console.log(`no historical top3 ${percent(summary.clean)}`);
console.log(`concepts resolved  ${percent(summary.concepts)}`);
console.log("─".repeat(60));
console.log("legend: ✗1 not first · ✗C answer missing · ✗F changelog in top3 · ✗G concept missed");
