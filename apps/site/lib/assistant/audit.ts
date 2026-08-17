import { type ApiSurface, scanJitExpressions } from "./api-surface";
import type { ConceptMatch } from "./graph";
import { conceptById } from "./graph";
import { fold } from "./tokenize";
import type { ApiMember, RetrievedSection } from "./types";

/**
 * The last gate before an answer is shown.
 *
 * Three things about this library are known exactly — its public surface, the
 * sections the answer was given, and the facts the graph established for the
 * question — so three classes of wrong answer can be caught rather than
 * trusted. A reader finding out from this banner costs them a second; finding
 * out from a failing build costs them an afternoon.
 *
 * It never edits the answer. A model that is wrong should be seen to be wrong,
 * not quietly patched into looking right.
 */

export type AuditFinding =
  /** Named something that is not part of the library. */
  | { kind: "invented-api"; names: string[] }
  /** Called a method that exists nowhere in the library or its documentation. */
  | { kind: "invented-method"; names: string[] }
  /** Invented a CLI command or flag. */
  | { kind: "invented-cli"; names: string[] }
  /** Showed code that does not demonstrate the library, or does not work. */
  | { kind: "unusable-example"; reason: string }
  /** Made a technical claim nothing it was given supports. */
  | { kind: "ungrounded-claim"; sentences: string[] }
  /** Quoted a figure that appears in none of the sections it was given. */
  | { kind: "unsupported-number"; values: string[] }
  /** Stated the opposite of a fact established for this question. */
  | { kind: "contradiction"; claim: string };

/** Namespaces the docs index enumerates; the others would be guesswork. */
const VERIFIED_ROOT = "JIT";

/**
 * Real exports that `Object.keys(JIT)` cannot see, because they are types
 * rather than values. Flagging `JIT.Typeof` — which the quick start teaches on
 * its first page — as invented is the fastest way to teach a reader that this
 * banner is noise.
 */
const TYPE_EXPORTS = new Set(["Typeof", "Strict"]);
const MENTION = /\b(JIT|AOT|Compiler)\.([A-Za-z_$][A-Za-z0-9_$]*)/g;

/** Figures a reader would act on: timings, sizes, and multipliers. */
const FIGURE = /\b\d+(?:[.,]\d+)?\s?(?:ns|µs|us|ms|s|x|%|KB|MB|GB|GiB|MiB)\b/gi;

export function unknownApiMentions(answer: string, api: ApiMember[]): string[] {
  if (api.length === 0) return [];

  const known = new Set(api.map((member) => member.name));
  const unknown = new Set<string>();

  for (const match of answer.matchAll(MENTION)) {
    const [, root, name] = match;
    if (root !== VERIFIED_ROOT || !name) continue;
    if (!known.has(name) && !TYPE_EXPORTS.has(name)) unknown.add(`${root}.${name}`);
  }

  return [...unknown];
}

/**
 * Names the answer used that the library does not have, at every level.
 *
 * This replaces a check that only ever looked at `JIT.x`. Two thirds of the
 * surface lives below that — `JIT.validate.safeParse`, `.min()`, `.pii()` — and
 * two thirds of the inventions did too. `JIT.compare.deepEqual`,
 * `JIT.security.redact` and `.notEmpty()` are all names a reader would paste
 * into an editor and all names the old audit waved through, because it stopped
 * reading at the first dot.
 */
export function unknownNames(answer: string, surface: ApiSurface): { apis: string[]; methods: string[] } {
  const apis = new Set<string>();
  const methods = new Set<string>();

  for (const expression of scanJitExpressions(answer)) {
    // A lowercase root is only judged once it is called. `jit.config.ts` is a
    // real filename and reading it as `JIT.config` would be a false alarm on
    // the CLI's own configuration file; `jit.generate({ … })` is a call, and
    // an invention.
    if (expression.lowercase && expression.calls.length === 0 && !expression.text.includes("(")) continue;

    if (!surface.hasMember(expression.root)) {
      apis.add(`JIT.${expression.root}`);
      // the rest of the chain hangs off a name that does not exist; judging it
      // would only repeat the same finding in a less useful form
      continue;
    }

    if (expression.member !== undefined) {
      // Only a namespace object has members to get wrong. `JIT.string().min()`
      // parses with `member` unset, and `JIT.object({...}).pick()` reaches here
      // with none either — but `JIT.compare.deepEqual` does, and is caught.
      if (surface.isNamespace(expression.root) && !surface.hasNamespaceMember(expression.root, expression.member)) {
        apis.add(`JIT.${expression.root}.${expression.member}`);
        continue;
      }
    }

    for (const call of expression.calls) {
      if (!surface.hasMethod(call)) methods.add(`.${call}()`);
    }
  }

  // A method invented on a local variable never touches a `JIT.` chain and so
  // escapes the walk above — `const result = await user.run()` is the exact
  // shape of the answer that started this. Inside a code block that is teaching
  // jit, a call to something that exists nowhere in the library or its
  // documentation is an invention wherever the receiver came from.
  for (const block of jitCodeBlocks(answer)) {
    for (const match of block.matchAll(/\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) {
      const name = match[1];
      if (!surface.hasMethod(name) && !JAVASCRIPT_BUILTINS.has(name)) methods.add(`.${name}()`);
    }
  }

  return { apis: [...apis], methods: [...methods] };
}

/** Every fenced block written in a language where jit code would live. */
export function scriptBlocks(answer: string): string[] {
  return [...answer.matchAll(/```(ts|tsx|typescript|js|javascript)\n?([\s\S]*?)```/g)].map((match) => match[2] ?? "");
}

/**
 * Fenced blocks that are teaching jit. A shell snippet or a JSON payload has
 * no method calls worth judging, and a block that never mentions the library
 * is not the library's to be wrong about.
 */
function jitCodeBlocks(answer: string): string[] {
  return scriptBlocks(answer).filter((code) => /\bjit\./i.test(code));
}

/**
 * An example that does not use the library.
 *
 * Asked why jit is fast, a model answered with hand-written JavaScript —
 * `user.id !== undefined && typeof user.name === "string"` — presented as if
 * it were the library in action. It is not wrong about any name, so every
 * name-based check passes it, and it is completely useless: the reader copies
 * it and has written jit out of their own program.
 *
 * Only fires when *no* block uses jit. An answer that contrasts hand-written
 * code with the jit version is doing something useful, and does it by showing
 * both.
 */
/**
 * Technology the answer drifted into.
 *
 * A model that has lost the thread reaches for whatever its training data
 * associates with the words in front of it, and "query" plus "data engine" is
 * enough to produce `User.query('SELECT * FROM users WHERE id = ?')` in the
 * middle of an answer about compiling schemas. jit has no database, no
 * connection, and no SQL, so any of this in an example is a hallucination with
 * a very clear fingerprint — worth naming exactly, because a reader who sees
 * SQL assumes the library has a database layer they have not found yet.
 */
const FOREIGN_TECHNOLOGY: [pattern: RegExp, name: string][] = [
  [/\b(?:SELECT|INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b[\s\S]{0,60}\bFROM\b|\bSELECT\s+\*/i, "SQL"],
  [/\b(?:mongoose|prisma|sequelize|knex|typeorm|drizzle)\b/i, "another ORM"],
  [/\b(?:createConnection|getRepository|\.collection\(|\.findOne\(|\.aggregate\(\[)/, "a database client"],
  [/\b(?:express|fastify|useState|useEffect|createSlice)\s*\(/, "an unrelated framework"],
];

export function unusableExample(answer: string): string | null {
  const blocks = scriptBlocks(answer);
  if (blocks.length === 0) return null;

  const code = blocks.join("\n");

  for (const [pattern, name] of FOREIGN_TECHNOLOGY) {
    if (pattern.test(code)) {
      return `it contains ${name}, which has nothing to do with jit — jit compiles schemas, it is not a database or a framework. Remove it and write the example with JIT.* only.`;
    }
  }

  if (blocks.some((block) => /\bJIT\./.test(block))) return null;

  return "it is plain JavaScript that never calls jit, so it does not show the reader how to do anything with the library. Write the example with JIT.* instead.";
}

/**
 * Language and platform methods a jit example legitimately calls. Kept short
 * on purpose: everything the documentation itself calls is already allowed, so
 * this only has to cover what a correct answer may reach for that the docs
 * happen never to have needed.
 */
const JAVASCRIPT_BUILTINS = new Set([
  "log",
  "error",
  "warn",
  "info",
  "then",
  "catch",
  "finally",
  "map",
  "filter",
  "forEach",
  "reduce",
  "find",
  "some",
  "every",
  "flatMap",
  "push",
  "concat",
  "join",
  "split",
  "indexOf",
  "sort",
  "reverse",
  "keys",
  "values",
  "entries",
  "toString",
  "bind",
  "call",
  "apply",
  "assign",
  "freeze",
  "test",
  "exec",
  "replace",
  "repeat",
  "at",
  "json",
  "text",
  "resolve",
  "reject",
  "all",
  "race",
  "now",
  "random",
  "isArray",
  "fromEntries",
]);

/**
 * Commands and flags the CLI does not have.
 *
 * "you can run `jit --version` to see the name of the compiled object" is a
 * real sentence a model produced, and it is the most expensive kind of wrong:
 * the reader runs it, gets an error, and stops trusting everything above it.
 * The command surface is small and fixed, so it can simply be listed.
 */
const CLI_COMMANDS = new Set(["generate", "init", "watch", "check", "mcp"]);

/**
 * A flag, anywhere code is written. Precise enough to scan inline spans too:
 * `--version` is not something prose says by accident, and inventing one is
 * the failure this exists to catch.
 */
const CLI_FLAG = /\bjit\s+(--?[a-z][\w-]*)/g;

/**
 * A subcommand, but only where a command is actually being given: at the start
 * of a line inside a fenced block, optionally behind a runner. Inline code is
 * excluded because prose sets ordinary words in code font — the docs say a
 * change is "reported by `jit list`" — and reading that as a subcommand
 * invents a complaint about the documentation's own sentence.
 */
const CLI_COMMAND = /^(?:\$\s*)?(?:(?:npx|pnpm|yarn|bun)(?:\s+exec)?\s+)?jit\s+([a-z][\w:-]*)/gm;

/**
 * The parts of an answer that are code: fenced blocks and inline spans.
 *
 * Prose has to be excluded before anything is read as a command, because a
 * Portuguese sentence about the library is full of `jit` followed by a verb —
 * "jit compila o schema", "jit não interpreta" — and reading those as
 * `jit compila` and `jit nao` produces two confident, absurd findings. A
 * warning that fires on correct prose is worse than no warning: it is the
 * reason readers learn to skip the banner that also reports the real ones.
 */
export function fencedOf(answer: string): string {
  const parts: string[] = [];
  for (const match of answer.matchAll(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g)) parts.push(match[1] ?? "");
  return parts.join("\n");
}

export function codeOf(answer: string): string {
  const parts: string[] = [fencedOf(answer)];
  for (const match of answer.matchAll(/`([^`\n]+)`/g)) parts.push(match[1] ?? "");
  return parts.join("\n");
}

export function unknownCliUsage(answer: string, sections: RetrievedSection[]): string[] {
  const evidence = sections.map((source) => source.section.text).join("\n");
  const unknown = new Set<string>();

  for (const match of codeOf(answer).matchAll(CLI_FLAG)) {
    // a flag is only credible if a section it was given actually shows it
    if (!evidence.includes(match[1])) unknown.add(`jit ${match[1]}`);
  }

  for (const match of fencedOf(answer).matchAll(CLI_COMMAND)) {
    const command = match[1];
    if (!CLI_COMMANDS.has(command) && !evidence.includes(`jit ${command}`)) unknown.add(`jit ${command}`);
  }

  return [...unknown];
}

/**
 * Numbers the answer states that no section it was given contains. The prompt
 * forbids inventing a benchmark figure; this is what notices when it happens
 * anyway.
 */
export function unsupportedFigures(answer: string, sections: RetrievedSection[]): string[] {
  const evidence = sections.map((source) => source.section.text).join(" ");
  if (!evidence) return [];

  const unsupported = new Set<string>();

  for (const match of answer.matchAll(FIGURE)) {
    const figure = match[0];
    const digits = figure.match(/\d+(?:[.,]\d+)?/)?.[0];
    // the digits are what matters; "18%" in the docs supports "18 %" here
    if (digits && !evidence.includes(digits)) unsupported.add(figure.trim());
  }

  return [...unsupported];
}

/**
 * Phrases that contradict a fact the graph established for this question.
 * Narrow on purpose: this fires only where the failure was actually observed —
 * an answer to "why is jit fast" that opens by saying it is not.
 */
const CONTRADICTIONS: Record<string, RegExp> = {
  performance:
    /\b(n[ãa]o (?:é|e) (?:mais )?r[áa]pid|(?:is|are)(?:n't| not) (?:any )?fast|mais lent|slower than (?:a )?(?:native|plain|generic)|projetado para ser mais lento|designed to be slow)/i,
  compilation: /\b(interpreta (?:o )?schema (?:a cada|em cada)|interprets the schema (?:on|at) (?:each|every) call)/i,

  /**
   * The two ways the execution modes get stated backwards, both observed.
   *
   * "no AOT ele existe apenas como uma biblioteca externa importada pelo
   * cliente" is the exact inverse of the truth — AOT is the mode where the
   * engine does *not* ship — and a reader who believes it picks the wrong
   * mode for their bundle. "runtime mode writes a .js file" is the same
   * confusion from the other side: runtime compiles into memory and writes
   * nothing.
   */
  aot: /\b(?:aot|ahead[- ]of[- ]time)\b[^.!?\n]{0,80}\b(?:biblioteca externa|external library|importad[ao] pelo cliente|imported by the client|ships? (?:to|in) (?:the )?(?:production|bundle|client)|inclu[ií]d[ao] no bundle)/i,
  runtime:
    /\b(?:runtime|em tempo de execu[çc][ãa]o)\b[^.!?\n]{0,80}\b(?:cria (?:um )?arquivo|writes? (?:a|an|one) (?:file|module|\.js)|gera (?:um )?arquivo|emits? a file (?:to|on) disk)/i,
};

export function contradictions(answer: string, concepts: ConceptMatch[]): string[] {
  const found: string[] = [];

  for (const match of concepts) {
    if (match.weight !== 1) continue;

    const pattern = CONTRADICTIONS[match.id];
    const fact = conceptById(match.id)?.fact;
    if (pattern?.test(answer) && fact) found.push(fact);
  }

  return found;
}

/** Words too common to count as evidence that two sentences say the same thing. */
const COMMON = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "you",
  "your",
  "its",
  "are",
  "was",
  "can",
  "not",
  "但",
  "que",
  "para",
  "com",
  "uma",
  "dos",
  "das",
  "por",
  "mais",
  "como",
  "isso",
  "seu",
  "sua",
  "ele",
  "ela",
  "jit",
  "schema",
  "code",
  "value",
  "data",
  "type",
  "function",
  "usar",
  "codigo",
  "dados",
]);

function contentWords(sentence: string): string[] {
  return sentence
    .toLowerCase()
    .split(/[^\p{L}\p{N}.]+/u)
    .map((word) => fold(word.replace(/\.$/, "")))
    .filter((word) => word.length > 3 && !COMMON.has(word));
}

/** A sentence that states something technical rather than framing the answer. */
function isTechnicalClaim(sentence: string): boolean {
  return /\bJIT\.|\b\d+(?:[.,]\d+)?\s?(?:ns|ms|x|%)|\b(compil|gener|valid|allocat|cache|loop|schema|parse|runtime|memory|thread|interpret)/i.test(
    sentence
  );
}

/**
 * Sentences the answer asserts that nothing it was given supports.
 *
 * This is the closest a browser can get to the way a claim gets checked by
 * hand: take what the answer states, and look for it in the evidence — the
 * retrieved sections plus the facts and mechanisms established for this
 * question. A sentence sharing almost no content word with any of them was not
 * read anywhere; it was produced.
 *
 * The threshold is deliberately forgiving. Flagging a correct paraphrase
 * teaches the reader to ignore the banner, which costs more than the miss.
 */
export function ungroundedClaims(answer: string, evidence: string): string[] {
  const supported = new Set(contentWords(evidence));
  if (supported.size === 0) return [];

  const flagged: string[] = [];

  for (const raw of answer.split(/(?<=[.!?])\s+|\n+/)) {
    const sentence = raw.trim();
    // code blocks are checked by the API audit, not as prose
    if (sentence.length < 40 || sentence.startsWith("```") || !isTechnicalClaim(sentence)) continue;

    const words = contentWords(sentence);
    if (words.length < 4) continue;

    const overlap = words.filter((word) => supported.has(word)).length / words.length;
    if (overlap < 0.25) flagged.push(sentence.length > 120 ? `${sentence.slice(0, 119)}…` : sentence);
  }

  return flagged;
}

/**
 * An invented name or a denied fact makes the answer actively misleading; an
 * unsupported figure or an unsourced sentence makes it thin. The first pair
 * has to be read before the answer is, the second is a footnote — a warning
 * placed under something a reader already believed arrives too late.
 */
export function isSevere(finding: AuditFinding): boolean {
  return (
    finding.kind === "invented-api" ||
    finding.kind === "invented-method" ||
    finding.kind === "invented-cli" ||
    finding.kind === "contradiction" ||
    // a reader copies an example before they finish reading the prose
    finding.kind === "unusable-example"
  );
}

export function audit(
  answer: string,
  context: {
    api: ApiMember[];
    sections: RetrievedSection[];
    concepts: ConceptMatch[];
    established?: string[];
    /** The real three-level surface, when it has loaded. */
    surface?: ApiSurface | null;
  }
): AuditFinding[] {
  const findings: AuditFinding[] = [];

  // The deep surface subsumes the flat check, so only one of them runs — two
  // findings naming the same invented member reads like two separate mistakes.
  if (context.surface) {
    const { apis, methods } = unknownNames(answer, context.surface);
    if (apis.length > 0) findings.push({ kind: "invented-api", names: apis });
    if (methods.length > 0) findings.push({ kind: "invented-method", names: methods });
  } else {
    const names = unknownApiMentions(answer, context.api);
    if (names.length > 0) findings.push({ kind: "invented-api", names });
  }

  const cli = unknownCliUsage(answer, context.sections);
  if (cli.length > 0) findings.push({ kind: "invented-cli", names: cli });

  const unusable = unusableExample(answer);
  if (unusable) findings.push({ kind: "unusable-example", reason: unusable });

  for (const claim of contradictions(answer, context.concepts)) {
    findings.push({ kind: "contradiction", claim });
  }

  const values = unsupportedFigures(answer, context.sections);
  if (values.length > 0) findings.push({ kind: "unsupported-number", values });

  const evidence = [...context.sections.map((source) => source.section.text), ...(context.established ?? [])].join(" ");
  const sentences = ungroundedClaims(answer, evidence);
  if (sentences.length > 0) findings.push({ kind: "ungrounded-claim", sentences });

  return findings;
}
