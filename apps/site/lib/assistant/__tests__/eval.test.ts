import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GOLD, HISTORICAL } from "../eval/gold";
import { judge, score } from "../eval/judge";
import { DocsRetriever } from "../retrieval";
import type { DocsIndex } from "../types";

const indexPath = resolve(import.meta.dirname, "../../../public/assistant/docs-index.json");
const index = JSON.parse(readFileSync(indexPath, "utf8")) as DocsIndex;
const retriever = new DocsRetriever(index);
const verdicts = GOLD.map((gold) => judge(gold, retriever, index));
const summary = score(verdicts);

/**
 * The floors, as measured after the retrieval work rather than as an
 * aspiration. They are set a little under the current numbers so an ordinary
 * documentation edit does not turn the suite red, and far enough above the
 * starting point that a real regression does.
 *
 * Where they started, before any of this: 52.5% first, 92.5% in context,
 * 85% clean, 72.5% concepts.
 */
describe("retrieval quality against the gold set", () => {
  it("covers both languages and every part of the surface", () => {
    expect(GOLD.length).toBeGreaterThanOrEqual(40);
    expect(GOLD.filter((gold) => gold.lang === "pt").length).toBeGreaterThanOrEqual(15);
  });

  it("ranks the right page first for most questions", () => {
    expect(summary.first).toBeGreaterThanOrEqual(0.78);
  });

  it("always puts an acceptable answer in the model's context", () => {
    expect(summary.inContext).toBe(1);
  });

  /**
   * The one that must never slip.
   *
   * The changelog is written in the vocabulary of every conceptual question,
   * and an answer built on release notes is what produced `jit --version` and
   * `.run()`. No question that is not about a version may see it in the top
   * three.
   */
  it("never lets the changelog answer a question about how the library works", () => {
    expect(summary.clean).toBe(1);
  });

  it("resolves a concept for every question", () => {
    expect(summary.concepts).toBe(1);
  });

  it("still lets the changelog win when the question is about a version", () => {
    const historical = GOLD.filter((gold) => gold.best?.some((page) => HISTORICAL.includes(page)));
    expect(historical.length).toBeGreaterThan(0);

    for (const gold of historical) {
      const verdict = verdicts.find((candidate) => candidate.gold === gold);
      expect(verdict?.first, gold.question).toBe(true);
    }
  });

  it("names the failures, so a regression report is readable", () => {
    const failures = verdicts
      .filter((verdict) => !(verdict.first && verdict.inContext && verdict.clean && verdict.concepts))
      .map((verdict) => `${verdict.gold.question} -> ${verdict.ranked.slice(0, 2).join(" | ")}`);

    // not an assertion about which ones fail, only that the report is small
    expect(failures.length).toBeLessThanOrEqual(GOLD.length * 0.22);
  });
});
