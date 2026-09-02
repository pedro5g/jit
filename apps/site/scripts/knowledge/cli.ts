/**
 * `pnpm knowledge:<command>`.
 *
 * Thin on purpose: everything it prints comes out of `build()`, so a build run
 * from CI, from a test and from a terminal do the same work and disagree only
 * about what they say afterwards.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { ARTIFACT_DIR } from "../../lib/copilot/config/artifacts";
import { runExplanationEval } from "../../lib/copilot/eval/explanation-run";
import { runEval } from "../../lib/copilot/eval/run";
import { createKnowledgeEngine } from "../../lib/copilot/infrastructure/knowledge-engine";
import { NodeArtifactLoader } from "../../lib/copilot/infrastructure/storage/node-artifact-loader";
import { build, cacheDir, outDir, siteDir } from "./build";
import { TransformersEmbedder } from "./embeddings/embed";
import { inspect } from "./inspect";
import { isFatal } from "./validate";

const [command = "build", ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((argument) => argument.startsWith("--")));

function report(result: Awaited<ReturnType<typeof build>>): number {
  let failed = 0;

  if (result.apiProblems.length > 0) {
    console.log(`\n[knowledge] ${result.apiProblems.length} documentation mismatch(es):`);
    for (const problem of result.apiProblems) console.log(`  - ${problem}`);
  }

  if (result.exampleFailures.length > 0) {
    console.log(`\n[knowledge] ${result.exampleFailures.length} failing example(s):`);
    for (const failure of result.exampleFailures) console.log(`  - ${failure.file}: ${failure.detail}`);
    failed += result.exampleFailures.length;
  }

  const fatal = result.problems.filter(isFatal);
  const advisory = result.problems.filter((problem) => !isFatal(problem));

  if (advisory.length > 0) {
    console.log(`\n[knowledge] ${advisory.length} advisory:`);
    for (const problem of advisory) console.log(`  - ${problem.kind}: ${problem.detail}`);
  }

  if (fatal.length > 0) {
    console.log(`\n[knowledge] ${fatal.length} problem(s) that must be fixed:`);
    for (const problem of fatal) console.log(`  - ${problem.kind}: ${problem.detail}`);
    failed += fatal.length;
  }

  return failed;
}

switch (command) {
  case "build": {
    const result = await build({
      embed: !flags.has("--no-embed"),
      verifyExamples: flags.has("--verify-examples"),
      write: true,
      quiet: false,
    });

    const failures = report(result);
    console.log(
      `\n[knowledge] ${result.entries.length} entries · ${result.chunks.length} chunks · ${result.symbols.length} symbols · ${result.routes.length} routes · ${result.manifest.counts.vectors} vectors`
    );
    if (result.cache.hits + result.cache.misses > 0) {
      console.log(`[knowledge] embedding cache: ${result.cache.hits} hit, ${result.cache.misses} miss`);
    }

    process.exit(failures > 0 ? 1 : 0);
    break;
  }

  case "validate": {
    // Nothing is written: the point is to fail CI on a tree that would produce
    // bad artifacts, without depending on whether artifacts happen to be
    // present. Embeddings are skipped because none of §67's failures involve
    // them, and a CI job should not download a model to check an id.
    const result = await build({ embed: false, verifyExamples: true, write: false, quiet: true });
    const failures = report(result);

    if (failures === 0) console.log("[knowledge] artifacts are valid");
    process.exit(failures > 0 ? 1 : 0);
    break;
  }

  case "clean": {
    await fs.rm(outDir, { recursive: true, force: true });
    if (flags.has("--cache")) await fs.rm(cacheDir, { recursive: true, force: true });

    console.log(`[knowledge] removed ${outDir}${flags.has("--cache") ? ` and ${cacheDir}` : ""}`);
    break;
  }

  case "inspect": {
    const question = rest.filter((argument) => !argument.startsWith("--")).join(" ");
    if (!question) {
      console.error('usage: pnpm knowledge:inspect "how do I validate a uuid" [--on /docs/quick-start] [--no-embed]');
      process.exit(2);
    }

    const onIndex = rest.indexOf("--on");
    await inspect(question, {
      ...(onIndex >= 0 && rest[onIndex + 1] ? { currentPath: rest[onIndex + 1] } : {}),
      noEmbed: flags.has("--no-embed"),
      showPrompt: flags.has("--prompt"),
    });
    break;
  }

  case "eval": {
    const loader = new NodeArtifactLoader(path.join(siteDir, "public", ARTIFACT_DIR));
    const engine = await createKnowledgeEngine(loader);

    // §78's capability levels are measurable rather than aspirational: the
    // same set runs with and without vectors, and the difference is what
    // semantic retrieval is actually worth.
    const embedder = flags.has("--no-embed") || !engine.hasSemanticSearch ? null : new TransformersEmbedder();
    const run = await runEval(engine, embedder);
    const { metrics } = run;

    const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
    console.log(`\n[knowledge] ${metrics.cases} cases · semantic ${embedder ? "on" : "off"}`);
    console.log(`  Recall@1              ${percent(metrics.recallAt1)}`);
    console.log(`  Recall@3              ${percent(metrics.recallAt3)}`);
    console.log(`  Recall@5              ${percent(metrics.recallAt5)}   (target > 95%)`);
    console.log(`  MRR                   ${metrics.mrr.toFixed(3)}`);
    console.log(`  exact symbol accuracy ${percent(metrics.exactSymbolAccuracy)}   (target 100%)`);
    console.log(`  navigation accuracy   ${percent(metrics.navigationAccuracy)}   (target > 98%)`);
    console.log(`  forbidden in top 3    ${metrics.forbiddenHits}   (target 0)`);
    console.log(`  no-evidence mistakes  ${run.evidenceMistakes.length}`);

    const ctx = run.context;
    console.log("\n  context quality");
    console.log(
      `    context recall        ${percent(ctx.contextRecall)}   (of what retrieval found, how much survived selection)`
    );
    console.log(`    contamination         ${percent(ctx.contamination)}   (target < 5%)`);
    console.log(`    average evidence      ${ctx.averageEvidence.toFixed(1)} passages`);
    console.log(
      `    average prompt        ${ctx.averageTokens} tokens   (${ctx.underBudget} under 1500, ${ctx.overBudget} over 2200)`
    );
    console.log(
      `    role mix              ${Object.entries(ctx.roleMix)
        .sort((a, b) => b[1] - a[1])
        .map(([role, count]) => `${role} ${count}`)
        .join(" · ")}`
    );

    console.log("\n  by mode");
    for (const [mode, bucket] of Object.entries(metrics.byMode).sort()) {
      console.log(
        `    ${mode.padEnd(20)} ${String(bucket.cases).padStart(4)} cases  R@1 ${percent(bucket.recallAt1).padStart(6)}  nav ${percent(bucket.navigation).padStart(6)}`
      );
    }

    const margins = run.outcomes.map((outcome) => outcome.semanticMargin).filter((margin) => margin > 0);
    if (margins.length > 0) {
      const sorted = [...margins].sort((left, right) => left - right);
      const ties = margins.filter((margin) => margin < 0.005).length;
      console.log(
        `\n  semantic margin       median ${sorted[Math.floor(sorted.length / 2)].toFixed(4)} · ${ties}/${margins.length} within 0.005 (a tie)`
      );
    }

    console.log("\n  by category");
    for (const [category, bucket] of Object.entries(metrics.byCategory).sort()) {
      console.log(
        `    ${category.padEnd(20)} ${String(bucket.cases).padStart(4)} cases  R@5 ${percent(bucket.recallAt5).padStart(6)}  MRR ${bucket.mrr.toFixed(3)}`
      );
    }

    if (flags.has("--failures")) {
      const failures = run.outcomes.filter(
        (outcome) =>
          (outcome.case.expected.routes?.length ?? 0) > 0 &&
          (outcome.firstHit === 0 ||
            outcome.firstHit > 5 ||
            outcome.forbiddenHits.length > 0 ||
            !outcome.bestCorrect ||
            !outcome.symbolsCorrect)
      );

      console.log(`\n  ${failures.length} failing case(s)`);
      for (const failure of failures) {
        console.log(`\n    ${failure.case.question}   [${failure.case.category}]`);
        console.log(`      expected  ${(failure.case.expected.routes ?? []).join(", ")}`);
        console.log(`      got       ${failure.routes.slice(0, 5).join(", ") || "(nothing)"}`);
        if (!failure.symbolsCorrect) {
          console.log(`      symbols   expected ${(failure.case.expected.symbols ?? []).join(", ")}`);
          console.log(`                got ${failure.symbols.join(", ") || "(nothing)"}`);
        }
        if (failure.forbiddenHits.length > 0) console.log(`      forbidden ${failure.forbiddenHits.join(", ")}`);
      }

      if (run.evidenceMistakes.length > 0) {
        console.log(`\n  ${run.evidenceMistakes.length} no-evidence mistake(s)`);
        for (const mistake of run.evidenceMistakes) {
          console.log(`    ${mistake.case.question} — top score ${mistake.topScore.toFixed(4)}`);
        }
      }

      const contaminated = run.contextOutcomes.filter((outcome) => outcome.contaminants.length > 0);
      if (contaminated.length > 0) {
        console.log(`\n  ${contaminated.length} contaminated context(s)`);
        for (const outcome of contaminated) {
          console.log(`    ${outcome.case.question}`);
          for (const passage of outcome.contaminants) console.log(`      ${passage}`);
        }
      }
    }

    console.log("");
    break;
  }

  case "eval:explain": {
    const loader = new NodeArtifactLoader(path.join(siteDir, "public", ARTIFACT_DIR));
    const engine = await createKnowledgeEngine(loader);
    const embedder = flags.has("--no-embed") || !engine.hasSemanticSearch ? null : new TransformersEmbedder();
    const metrics = await runExplanationEval(engine, embedder);
    const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
    console.log(`\n[knowledge] ${metrics.cases} explanation cases · semantic ${embedder ? "on" : "off"}`);
    console.log(`  graph                     ${metrics.graphNodes} nodes · ${metrics.graphEdges} edges`);
    console.log(
      `  graph sources             ${Object.entries(metrics.graphBySource)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([source, count]) => `${source} ${count}`)
        .join(" · ")}`
    );
    console.log(
      `  graph relations           ${Object.entries(metrics.graphByKind)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([kind, count]) => `${kind} ${count}`)
        .join(" · ")}`
    );
    console.log(`  seed facet coverage       ${percent(metrics.seedFacetCoverage)}`);
    console.log(`  expanded facet coverage   ${percent(metrics.expandedFacetCoverage)}`);
    console.log(`  expansion candidate recall ${percent(metrics.expansionCandidateFacetCoverage)}`);
    console.log(`  seed contamination        ${percent(metrics.seedContamination)}`);
    console.log(`  expanded contamination    ${percent(metrics.expandedContamination)}   (target <= 5%)`);
    console.log(`  generation readiness      ${percent(metrics.readyToGenerate)}`);
    console.log(`  expansion latency         ${metrics.averageExpansionMs.toFixed(2)} ms average`);
    console.log(
      `  context size              ${metrics.averageContextTokens.toFixed(0)} average · ${metrics.p95ContextTokens} P95 tokens`
    );
    console.log(
      `  semantic latency          embedding ${metrics.averageQueryEmbeddingMs.toFixed(2)} ms · scan ${metrics.averageVectorScanMs.toFixed(3)} ms · top-K ${metrics.averageVectorTopKMs.toFixed(3)} ms`
    );
    const failures: string[] = [];
    if (metrics.expandedFacetCoverage <= metrics.seedFacetCoverage) {
      failures.push("expanded facet coverage must exceed the retrieval-only seed baseline");
    }
    if (metrics.expandedContamination > 0.05) {
      failures.push(
        `expanded contamination must remain at or below 5% (got ${percent(metrics.expandedContamination)})`
      );
    }
    if (failures.length > 0) {
      for (const failure of failures) console.error(`  FAIL ${failure}`);
      process.exitCode = 1;
    }
    break;
  }

  default:
    console.error(`unknown command ${command} — expected build, validate, inspect, eval, eval:explain or clean`);
    process.exit(2);
}
