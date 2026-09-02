# Documentation copilot coverage planning

## Problem

Nearest-neighbour retrieval answers which passages resemble a question. A broad
explanation needs a different decision: which distinct documented aspects are
necessary for a complete answer. The site copilot keeps retrieval as the seed
mechanism and adds deterministic expansion and coverage planning before local
model synthesis.

## Knowledge compilation

`apps/site` compiles documentation sections, symbols, routes and examples into
stable `KnowledgeId`, `SymbolId` and `RouteId` records. The same build derives
facets from headings, bold explanatory labels, page hierarchy, route hierarchy,
symbols and canonical entry kinds. It also emits `relations.json` as compact
JSON tuples. Relations come from heading/route hierarchy, MDX links, declared
related pages, shared symbols and shared compiler-derived concepts. No model
creates or changes this graph.

An edge means that two entries are useful neighbours. It never establishes a
fact; only entry content and the compiled API surface are sources of truth.

## Runtime pipeline

Exact symbol, BM25, exact vector and current-context retrieval feed RRF as
before. Up to five unique seeds enter a breadth-preserving expansion with a
two-level and thirty-candidate ceiling. Every candidate records its source
entry, relation, depth, seed score and reranked relevance. A visited set makes
bidirectional cycles harmless.

The coverage planner classifies lookup, focused and broad questions and maps
them to lookup, explain, deep-explain, navigate or code answer modes. Facets
are ranked from compiled metadata. Broad selection preserves seed evidence,
adds non-redundant supporting aspects and uses a small fixed evidence ceiling.
`ContextService` remains responsible for final deduplication, source
attribution, token allocation and serialization into generic aspect sections.
The normal relative-confidence floor remains in force for reference pages. A
selected source-derived facet may lower that floor only for a `concept` or
`overview` entry, down to 0.45, so one strong semantic hit cannot erase the
second conceptual aspect that makes a broad answer complete.

Generation readiness depends on evidence count, facet coverage and source
confidence, not model size. Rejected output receives at most one retry with
exact audit findings. Deterministically mapped unsupported sentences may be
salvaged; otherwise grounded synthesis renders attributed evidence without a
second model.

## Vector strategy and complexity

Vectors remain L2-normalized `Float32Array` values packed as `N × dimensions`.
Exact scoring is `O(N × d)` and allocates nothing per document in its inner
loop. A bounded min-heap keeps top K in `O(N log K)` and only the final K
matches become objects. The repository reports vector count, dimensions,
scan-plus-heap time, final top-K ordering time and total time.

ANN remains a non-goal until browser measurements show an unacceptable P95 on
real devices or corpus size. Any future threshold must be based on those
measurements; no unmeasured constant is treated as a product boundary.

## Measurement

`pnpm knowledge:eval:explain` runs forty bilingual conceptual questions and
reports seed versus expanded facet coverage, contamination, readiness,
expansion latency and context token distribution. Expected facets resolve from
the knowledge metadata behind canonical source sections, never from response
strings. The command fails when expansion does not beat the retrieval-only
baseline or when expanded context contamination exceeds five percent.
`/lab/benchmark` runs the same suite against the actual WebGPU model and records
grounding, completeness, facet coverage, specificity, redundancy, language,
hallucination, latency and memory.

On Node 22.17.1 on the project benchmark host, the current 40-case semantic run
raises mean facet coverage from 30.1% to 31.7%, keeps seed and expanded
contamination at 5.0% (the configured maximum), and marks 82.5% of cases ready
for generation. Expansion averages 26.44 ms. Total prompt context averages
1,326 tokens with a 1,856-token P95. Query embedding averages 45.38 ms; exact
vector scan and bounded top-K selection average 1.494 ms and 0.022 ms
respectively. These are headless retrieval and planning measurements, not
browser-model generation results.

With embeddings disabled, the same suite measures 21.2% seed coverage versus
24.7% after expansion, zero contamination, 87.5% readiness, 22.90 ms average
expansion and 1,380 tokens average context (1,888-token P95). The two runs are
reported separately because semantic retrieval changes the seed distribution.

The headless model remains a lower bound and is never reported as the browser
0.8B tier. The graph is retained only while measured expansion improves facet
coverage without pushing context contamination above five percent.

The host-browser harness was exercised against the acceptance case on Edge 152
with WebGPU (AMD GCN5, 16 cores, 16 GB): one Qwen3.5 0.8B case completed in
53.5 s at 8.0 tokens/s, including the single audit retry, with 580.2 ms query
embedding, 1.10 ms vector scan and 0 ms top-K finalization. The delivered
result was 100% grounded by deterministic synthesis, with 80.5% explanation
completeness and 70.0% facet coverage; the raw model answer was rejected and
the fallback was used. This is a one-case validation, not a 40-case browser
quality claim. Qwen3 1.7B could not create a browser session on that 16 GB host
(`std::bad_alloc`), so it has no comparable result.

## Tradeoffs and non-goals

Expansion adds a small planning cost and can expose plausible but irrelevant
neighbours, so traversal and context remain strictly bounded and inspectable.
Uncited model explanations are blocked; only cited model prose or the generic
evidence-only fallback can cross the delivery boundary.
More context is not assumed to be better for a 0.8B model. HNSW, vector
databases, server RAG, external rerankers, generated graph edges, hardcoded
answers and query-specific preferred passages are intentionally out of scope.
