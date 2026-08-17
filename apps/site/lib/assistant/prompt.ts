import type { ApiSurface } from "./api-surface";
import { solutionBlock } from "./solutions";
import type { ApiMember, RetrievedSection } from "./types";
import { groundTruth, mechanisms, type Understanding } from "./understanding";

/**
 * The models behind this assistant are small — under a billion parameters by
 * default, running on the reader's own GPU. A small model follows a short,
 * concrete instruction far better than a long one, and it invents API names
 * the moment it is allowed to answer from memory.
 *
 * The action vocabulary is deliberately one line long. Anything harder to
 * write than `[[go:/docs/...]]` gets emitted malformed, and anything the model
 * fails to emit is recovered from retrieval instead — so the ghost stays
 * imperative even when the model is having a bad day.
 */
/**
 * What stays true across every page, so the ghost never has to infer it from
 * whichever three sections retrieval happened to return. These are the facts
 * that make an answer sound like someone who knows the library rather than
 * someone reading it for the first time — and the ones a small model gets
 * wrong most often when left to guess.
 */
const CONCEPTS = `What jit is, always true:
- jit walks a schema once at compile time and emits specialized straight-line JavaScript for each operation. It never interprets a schema at call time.
- Two execution modes, same generated code: runtime JIT compiles on first use through \`globalThis.Function\`; AOT (\`jit generate\`) emits an import-free module at build time, which is what runs under strict CSP and edge runtimes.
- Every capability is reached through exactly one namespace: JIT.validate.*, JIT.compare.*, JIT.security.*, JIT.json.*, JIT.binary.*. There are no root aliases.
- An aggregate is a plain object of artifacts, written as an ordinary object literal.
- If a name is not in the API list, it does not exist. Older names removed in 2.0 still appear in the migration guide as counter-examples; they are not usable code.
- A query builder is the query: call it for the eager backend, or reach .to.iterator(), .to.asyncIterator(), .to.visitor().
- Schemas are written with \`import { JIT } from "@jit-compiler/jit/runtime"\`. A file that AOT generation reads imports from "@jit-compiler/jit/define" instead.
- "Run" and "Generate" are the two BUTTONS in the site's workspace. They are not methods and there is no .run() or .generate() — never write one.`;

const SYSTEM_PROMPT = `You are the jit ghost, the guide inside the jit documentation. jit is a compiled data engine for TypeScript.

Hard rules, in order:
1. Answer ONLY from the DOCUMENTATION SECTIONS below. They are the truth. If they contradict what you believe, they win.
2. Use ONLY names from the API list below. If the name you want is not there, it does not exist — say what the docs do offer instead.
3. If the sections do not answer the question, say exactly that in one sentence and name the closest section. Do not fill the gap.
4. Never state a benchmark number, an option name, or a config key that is not written in the sections.

Then:
- Lead with the answer, then one line on why. Two or three sentences, then code if code helps.
- Never open with "Yes", "No", "Sim" or "Não" unless the reader asked a yes-or-no question. A "why" question is not one.
- Cite as [1], [2].
- Write jit code in \`\`\`ts blocks, complete and runnable.
- Reply in the language the reader used.
- Talk like the colleague at the next desk: direct, warm, no filler.

Actions, one per line, anywhere in your answer:
- [[go:/docs/...]] — offer the reader a link to that page. ONLY a path that appears in the sections below. It becomes a link in the conversation; it does not move them, so it never replaces explaining the answer.
- [[show:Exact heading]] — point at something on the page they are already reading.`;

/** Characters of context, chosen to fit the smallest supported window. */
const MAX_CONTEXT_CHARS = 5200;

/**
 * The complete public surface as one line per member. It is small — under two
 * thousand characters — and it is the difference between an answer that names
 * `JIT.map` and one that invents `JIT.mapper`, whichever page retrieval found.
 */
export function apiSurface(api: ApiMember[], surface?: ApiSurface | null): string {
  if (api.length === 0) return "";

  const members = api.map((member) => {
    // A namespace's own members are the names that actually get written.
    // `JIT.validate` is never called; `JIT.validate.safeParse` is, and listing
    // the purpose text instead left the model to guess the method — which is
    // how `JIT.compare.deepEqual` and `JIT.security.redact` got written.
    const namespaceMembers = surface?.member(member.name)?.members ?? [];
    if (namespaceMembers.length > 0) return `JIT.${member.name}.{ ${namespaceMembers.join(", ")} }`;

    return member.purpose ? `JIT.${member.name} — ${member.purpose}` : `JIT.${member.name}`;
  });

  return `The complete public API. Never use a name that is not in this list:\n${members.join("\n")}`;
}

/**
 * The API list is a fifth of the prompt. It earns that on a question that
 * names an API or asks how to do something; on "why is jit fast" it is 480
 * tokens of noise competing with the documentation for a small model's
 * attention, so it is left out.
 */
function needsApiSurface(understanding: Understanding | undefined): boolean {
  if (!understanding) return true;
  return understanding.apis.length > 0 || understanding.intent === "api" || understanding.intent === "howto";
}

export function systemPrompt(
  api: ApiMember[] = [],
  understanding?: Understanding,
  surface?: ApiSurface | null
): string {
  const listing = needsApiSurface(understanding) ? apiSurface(api, surface) : "";
  return [SYSTEM_PROMPT, CONCEPTS, listing].filter(Boolean).join("\n\n");
}

/**
 * Renders the retrieved sections as the numbered block the citation rule
 * refers to, truncating whole sections rather than cutting one mid-sentence.
 */
export function contextBlock(sections: RetrievedSection[]): string {
  const lines: string[] = [];
  let budget = MAX_CONTEXT_CHARS;

  for (const [index, { section }] of sections.entries()) {
    // a section that quotes removed APIs must never be read as code to copy
    const warning = section.showsRemovedApis
      ? " — WARNING: quotes APIs REMOVED in 2.0 as counter-examples. Never write a name from this section unless it is also in the API list."
      : "";
    const header = `[${index + 1}] ${section.page} — ${section.heading} (${section.url})${warning}`;
    const entry = `${header}\n${section.text}`;
    if (entry.length > budget) {
      // one whole section short of the budget beats a sentence cut in half
      if (lines.length === 0) {
        // the header and the newline joining it to the text are part of the budget
        lines.push(`${header}\n${section.text.slice(0, Math.max(0, budget - header.length - 1))}`);
      }
      break;
    }

    lines.push(entry);
    budget -= entry.length;
  }

  return lines.join("\n\n");
}

export interface TurnContext {
  question: string;
  sections: RetrievedSection[];
  currentUrl: string;
  /** Code the reader currently has in the workspace, when they are in it. */
  editorCode?: string | undefined;
  /** What the pipeline worked out about the question before retrieving. */
  understanding?: Understanding | undefined;
}

/**
 * The single most common way an answer goes wrong: "jit" is read as
 * just-in-time compilation in general, and the model starts explaining
 * JavaScript engines, inventing `JIT.js` and `JIT.exe`. Stating the identity
 * costs one line and removes the whole failure mode.
 */
/**
 * Stated positively, and deliberately so.
 *
 * The first version of this line was a list of negations — "it is not
 * just-in-time compilation, not a JavaScript engine, not a runtime" — and a
 * small model handed a list of negations writes them back out. That is
 * literally where "a jit não é uma linguagem de execução que roda sobre o
 * sistema operacional" came from: the model was reciting this instruction at
 * the reader. Telling it what the subject *is* anchors it just as well and
 * leaves it nothing to parrot.
 */
const IDENTITY =
  '"jit" here is the npm package @jit-compiler/jit: a compiled data engine for TypeScript, documented in the sections below. Write about that package. Describe what it is and what it does — never what it is not.';

/**
 * What the reader is asking for decides the shape of a good answer, and a
 * small model does not infer that reliably from the question alone.
 */
const SHAPE_BY_INTENT: Record<Understanding["intent"], string | null> = {
  concept: "They are asking why or what. Explain the idea first; code is optional.",
  howto: "They are asking how. Give the steps and a complete, runnable ```ts block.",
  api: "They named an API. State its exact signature and behaviour from the sections, then one example.",
  compare: "They are comparing. Give the honest tradeoff, and say where the other option is the better choice.",
  troubleshoot: "Something is failing. Name the likely cause first, then the fix.",
};

/** A short line naming what the question turned out to be about. */
function framing(understanding: Understanding | undefined): string | null {
  if (!understanding) return null;

  const parts: string[] = [];
  if (understanding.aboutTheLibrary) parts.push(IDENTITY);

  // Verified sentences about what the question is actually about. They come
  // first because they are the part the model must not contradict.
  const facts = groundTruth(understanding.concepts);
  if (facts.length > 0)
    parts.push(`ESTABLISHED FACTS — do not contradict these:\n${facts.map((fact) => `- ${fact}`).join("\n")}`);

  // the strategies, so an explanation can be concrete rather than a slogan
  const how = mechanisms(understanding.concepts, understanding.intent);
  if (how.length > 0) {
    parts.push(
      `HOW IT ACTUALLY WORKS — use these, they are the technical substance:\n${how.map((line) => `- ${line}`).join("\n")}`
    );
  }

  // The recipe for the problem they described, when there is one. It goes
  // above the shape hint because it decides the whole answer: someone who
  // knows the library reads "meu array está lento ao filtrar" and answers with
  // JIT.query and .indexBy, not with whatever page mentions "filter".
  const recipe = solutionBlock(understanding.solutions);
  if (recipe) parts.push(recipe);

  const shape = SHAPE_BY_INTENT[understanding.intent];
  if (shape) parts.push(shape);
  if (understanding.apis.length > 0) {
    parts.push(`The reader named: ${understanding.apis.map((api) => `JIT.${api}`).join(", ")}. Answer about those.`);
  }
  if (understanding.language === "pt") parts.push("The reader wrote in Portuguese. Answer in Portuguese.");

  return parts.length > 0 ? parts.join("\n") : null;
}

/** The turn actually sent to the model: context first, question last. */
/**
 * Somewhere to go next, from the two places that know: the concept graph's own
 * edges, and the `related:` directive on the pages retrieval actually returned.
 *
 * Offered as a line in the answer rather than acted on. A reader who asked a
 * question wants it answered, not to be moved to another page mid-sentence —
 * the ghost used to end every exchange by navigating, and the answer they were
 * reading went with it.
 */
function relatedLine(sections: RetrievedSection[], understanding: Understanding | undefined): string | null {
  const seen = new Set(sections.map((source) => source.section.url.split("#")[0]));
  const pages = new Set<string>();

  for (const page of understanding?.relatedPages ?? []) if (!seen.has(page)) pages.add(page);
  for (const source of sections.slice(0, 2)) {
    for (const page of source.section.related ?? []) if (!seen.has(page)) pages.add(page);
  }

  if (pages.size === 0) return null;

  return `RELATED PAGES: ${[...pages].slice(0, 3).join(", ")}. If one is genuinely the next thing to read, close with ONE short line naming it and its path. Never more than one, and never instead of answering.`;
}

export function userTurn({ question, sections, currentUrl, editorCode, understanding }: TurnContext): string {
  const context = contextBlock(sections);
  const parts: string[] = [];

  const frame = framing(understanding);
  if (frame) parts.push(frame);
  if (currentUrl) parts.push(`The reader is on ${currentUrl}.`);

  // With the editor open, a complete block is not an illustration — it lands in
  // their editor and runs. Saying so is what turns "here is how you would write
  // it" into the schema they asked for.
  if (editorCode?.trim()) {
    parts.push(
      `Their workspace editor is open and currently holds:\n\`\`\`ts\n${editorCode.trim().slice(0, 1200)}\n\`\`\`\n` +
        "When they ask you to write or change a schema, reply with the COMPLETE file in one ```ts block — it replaces what is in their editor and runs there. Keep the parts they did not ask you to change."
    );
  }

  parts.push(`DOCUMENTATION SECTIONS:\n${context || "(none matched this question)"}`);
  const related = relatedLine(sections, understanding);
  if (related) parts.push(related);

  parts.push(`QUESTION: ${question}`);

  return parts.join("\n\n");
}

/**
 * Gemma's chat template has no system role, so the instructions ride on the
 * first user turn instead. Chrome's Prompt API takes a real system prompt.
 */
export function foldSystemIntoFirstTurn(
  turn: string,
  api: ApiMember[] = [],
  understanding?: Understanding,
  surface?: ApiSurface | null
): string {
  return `${systemPrompt(api, understanding, surface)}\n\n---\n\n${turn}`;
}

/**
 * Three things worth asking next, drawn from what retrieval actually found
 * rather than from the model — so they appear instantly, are always real
 * pages, and cost nothing.
 */
export function followUpsFor(sections: RetrievedSection[], asked: string): string[] {
  const seen = new Set([normalize(asked)]);
  const questions: string[] = [];

  // A heading like "Performance" appears on a dozen pages, so on its own it
  // makes three identical-looking follow-ups. Naming the page is what turns
  // them back into three different questions.
  const headingCounts = new Map<string, number>();
  for (const { section } of sections) {
    const key = normalize(section.heading);
    headingCounts.set(key, (headingCounts.get(key) ?? 0) + 1);
  }

  for (const { section } of sections.slice(1)) {
    const ambiguous = (headingCounts.get(normalize(section.heading)) ?? 0) > 1;
    const subject = ambiguous ? `${section.heading} in ${section.page}` : section.heading;
    const question = `How does ${subject} work?`;

    if (seen.has(normalize(question))) continue;

    seen.add(normalize(question));
    questions.push(question);
    if (questions.length === 3) break;
  }

  return questions;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
