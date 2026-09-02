# JIT documentation copilot

The copilot is a browser-local, evidence-first assistant for the JIT documentation. It compiles its knowledge from the documentation, API surface, routes, and executed examples. A language model may explain that evidence, but it is never a source of API truth.

## Runtime architecture

The dependency direction is `presentation -> application -> core`; infrastructure implements core ports. `CopilotController` is the browser composition root. It loads immutable knowledge artifacts, constructs retrieval and audit services, and exposes search, audited answers, and constrained schema generation to React.

The capability ladder is progressive:

1. exact-symbol and BM25 search always work from shipped artifacts;
2. semantic retrieval is optional and only enabled when vectors and WebGPU are available;
3. deterministic expansion and coverage planning assemble explanatory facets;
4. local generation is optional and degrades to grounded synthesis on failure;
5. navigation actions are parsed from an allowlisted protocol;
6. schema requests produce validated `SchemaIntent`, then deterministic JIT source.

Normal answers use a bounded tool loop. Only registered read-only tools can run, duplicate calls are ignored, and at most four calls are accepted. The final answer is audited. Fatal findings and policy-blocked grounding/drift warnings get one constrained retry; a second rejected result is replaced by a localized evidence-only fallback. Rejected prose and its paired question never enter conversation history, and findings about discarded prose are not rendered as though they described the fallback.

Coverage is deny-by-default for questions that claim support for, or integration with, an unknown external subject. Unknown wording on a strongly retrieved conceptual question remains diagnostic instead of erasing its evidence; this is required for Portuguese questions over the English corpus. Claim grounding uses the same bilingual concept expansion as retrieval.

Fenced TypeScript and JavaScript in a generated answer is transpiled and executed against the real runtime in a disposable browser worker with an abort signal and a 2.5 second limit. A failed or unsafe example is a fatal audit finding. Conceptual questions do not request decorative code. Model tier does not decide whether conceptual generation is allowed: `GenerationReadiness` uses evidence count, facet coverage and source confidence. The light 0.8B tier may therefore explain a covered question and falls back only when evidence is insufficient, generation is unavailable or audit rejects the answer.

Retrieval remains exact symbol + BM25 + exact vector scan + current context, fused through RRF. Its top entries become a bounded seed set. `KnowledgeExpansionService` walks at most two levels and thirty candidates in the compiler-generated graph, carrying the edge reason and never treating an edge as a fact. `CoveragePlanner` discovers source-derived facets, preserves seed evidence, penalizes repetition and maximizes coverage per token. `ContextService` then applies the final token budget and serialization.

## Compiled knowledge

Run from `apps/site`:

```bash
pnpm knowledge:build
pnpm knowledge:validate
pnpm knowledge:eval
pnpm knowledge:eval:explain
```

`knowledge:build` writes versioned artifacts under `public/copilot/v1`, including compact JSON relation tuples derived from heading/route hierarchy, MDX links, frontmatter, shared symbols and compiler-derived concepts. They are generated and ignored. The manifest hash invalidates stale caches. `knowledge:validate` compiles in memory and rejects duplicate identifiers, unknown routes, dangling relations, and invalid examples.

The frozen legacy lexical index remains only as benchmark configuration A. It is not used by the product.

## Measurement

The retrieval evaluation has 264 deterministic cases. On the current artifact set with semantic retrieval enabled it measured:

- Recall@5: 95.3%
- exact-symbol accuracy: 100%
- navigation accuracy: 100%
- forbidden history pages in the top three: 0
- no-evidence classification mistakes: 0
- selected-context recall: 97.6%
- selected-context contamination: 0%
- average prompt: 1,707 estimated tokens

These numbers measure retrieval and context selection, not factual correctness of generated prose. Do not describe them as “98% answer accuracy.” Generation quality is measured separately from saved transcripts with deterministic detectors and hand-read labels.

The 40-case bilingual explanation evaluation measures the coverage planner independently of a model. The current semantic run raises expected facet coverage from 30.1% for seed-only selection to 31.7% after bounded graph expansion, while contamination is 5.0% (the configured maximum), readiness is 82.5%, and context averages 1,326 tokens (P95 1,856). Vector retrieval scans 618 normalized 384-dimensional embeddings in a flat `Float32Array`; the current Node measurement is 0.294 ms average for bounded top-8 heap selection, versus 0.309 ms for scoring and fully sorting the flat array (0.366 ms for the nested-array baseline). These figures are retrieval/planning measurements, not browser generation measurements.

The host-browser harness also completed the acceptance case once in Edge 152/WebGPU on AMD GCN5 (16 cores, 16 GB): Qwen3.5 0.8B took 53.5 s at 8.0 tokens/s, including the single audit retry. Its raw prose was rejected by the audit; deterministic grounded synthesis delivered 100% grounded output with 80.5% explanation completeness and 70.0% facet coverage. This is not a 40-case browser quality result. Qwen3 1.7B could not create a session on that host (`std::bad_alloc`).

The release-readiness gate requires at least 100 human-labelled browser transcripts, at least 98% rejection precision and recall, and at most a 2% false-positive rate. A tiny or unlabeled run cannot pass by reporting a vacuous 100%. This repository currently has no committed browser labels, so no generated-answer accuracy claim is made yet.

```bash
pnpm knowledge:benchmark             # headless A/B/C; long and memory-heavy
pnpm knowledge:benchmark -- --only B --limit 2
pnpm knowledge:label -- <run-id>
pnpm knowledge:rescore -- <run-id>
```

Headless configuration B uses Qwen2.5 0.5B because the browser's Qwen3.5 0.8B graph does not load under `onnxruntime-node`. Its result is a lower-bound experiment, never a measurement of the browser tier. The browser benchmark at `/lab/benchmark` is the authoritative WebGPU/product measurement and records its runtime and hardware separately. It runs the forty-case bilingual explanation suite and resolves expected facet IDs from the exact compiled knowledge artifact used by that run.

Benchmark outputs are regenerable and ignored under `.eval/copilot/runs`. Human labels under `.eval/copilot/labels/*.jsonl` are the committed ground truth. Detectors report observations; `AuditPolicy` alone decides whether the product shows an answer.

## Change checklist

When public API or documentation changes, rebuild knowledge, declarations, and the lab bundle; then run the documentation audit, retrieval evaluation, typecheck, and tests. Never add a hand-written fact when it can be extracted from the real source, never silently broaden the tool protocol, and never tune a detector against its own output.
