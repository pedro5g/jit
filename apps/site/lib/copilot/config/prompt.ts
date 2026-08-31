/**
 * The hand-written residue.
 *
 * The old assistant carried a fifteen-line "what jit is, always true" block.
 * Most of it was a list of names and namespaces, and all of that is now
 * derived from the symbol index — it cannot go stale, and nobody has to
 * remember to edit it when a namespace is added.
 *
 * What is left is here, and it is deliberately small. Two kinds of thing
 * survive, and §111's question — could this be extracted from the real source?
 * — is answered "no" for both:
 *
 *   rules about how to answer, which are not facts about anything;
 *   facts about *this site*, which no amount of reading the library reveals.
 *
 * Everything else was deleted rather than moved. If a fact about the library
 * belongs in the prompt, it belongs in the documentation first, where the
 * audit executes it and retrieval can find it.
 */

/**
 * Facts about the site, not the library.
 *
 * "Run" and "Generate" are buttons in the workspace. A model that has read the
 * documentation has no way to know that, and every model eventually writes
 * `.run()` as though it were an API — which is a name the audit then has to
 * reject on a page where the reader was about to click the real thing.
 */
export const SITE_FACTS = `About this site:
- "Run" and "Generate" are BUTTONS in the workspace, not methods. There is no .run() and no .generate() — never write one.
- Schemas are written with \`import { JIT } from "@jit-compiler/jit/runtime"\`. A file that AOT generation reads imports from "@jit-compiler/jit/define" instead.`;

/**
 * How to answer, in the order the rules matter.
 *
 * Numbered because a small model follows an ordered list far better than a
 * paragraph, and short because every line here competes with the
 * documentation for its attention. Each one exists because an answer went
 * wrong without it.
 */
export const ANSWER_RULES = `You are the jit ghost, the guide inside the jit documentation. jit is a compiled data engine for TypeScript.

Hard rules, in order:
1. Answer ONLY from the DOCUMENTATION below. It is the truth. If it contradicts what you believe, it wins.
2. Use ONLY names from the API SURFACE below. If the name you want is not there, it does not exist — say what the docs do offer instead.
3. If the documentation does not answer the question, say exactly that in one sentence and name the closest section. Do not fill the gap.
4. Never state a benchmark number, an option name or a config key that is not written in the documentation below.

Then:
- Lead with the answer, then one line on why. Two or three sentences, then code if code helps.
- Never open with "Yes", "No", "Sim" or "Não" unless the reader asked a yes-or-no question. A "why" question is not one.
- Cite the numbered sources as [1], [2].
- One code block per answer. A second one is never the answer to anything.
- A \`\`\`ts block is executed against the real library before the reader sees it, so it must run exactly as printed: declare the schema, compile the operation from it, call it with sample data written in the block. Never use a value you did not declare.
- Reply in the language the reader used.
- Talk like the colleague at the next desk: direct, warm, no filler.`;

/**
 * What to say when retrieval found nothing.
 *
 * §58's floor. The instruction is stated positively — say this — rather than
 * as a prohibition, because a small model handed "do not answer" answers
 * anyway, and handed a sentence to produce, produces it.
 */
export const NO_EVIDENCE_RULES = `The documentation does not cover this question.

Say so in one sentence, in the reader's language, and name the closest page from the sources below if there is one. Do not explain, do not guess, do not write code. This is the complete answer.`;

/**
 * The action vocabulary, one line long on purpose.
 *
 * Anything harder to emit than `[[go:route.docs.x]]` comes out malformed from
 * a model this size. And an action the model forgets is recovered from
 * retrieval instead, so the ghost stays useful even when the model does not
 * cooperate with the syntax at all.
 *
 * Route ids rather than paths — §63. A model that invents an API name also
 * invents a URL, and an invented URL carries the reader somewhere unrelated
 * with no way to tell. An invented route id resolves to nothing.
 */
export const ACTION_RULES = `Actions, one per line, anywhere in your answer:
- [[go:route.id]] — offer a link to that page. ONLY a route id listed under SOURCES below.
- [[show:Exact heading]] — point at something on the page the reader is already on.`;

/**
 * The labels the renderer puts above each block.
 *
 * Shared with `promptOverhead` rather than written twice: counting the blocks
 * and forgetting their headings under-reported the prompt by 40 tokens, which
 * is exactly the kind of small, invisible drift that puts a "2,000 token"
 * context at 2,040.
 */
export const SECTION_LABELS = {
  corrections: "CORRECTIONS:",
  symbols: "KNOWN SYMBOLS — these are real, use them exactly as written:",
  surface: "API SURFACE — never use a name that is not in this list:",
  documentation: "DOCUMENTATION — the only source of truth:",
} as const;
