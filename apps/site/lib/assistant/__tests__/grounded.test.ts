import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { degenerated, unusableExample } from "../audit";
import { DEFAULT_GENERATION_MODEL, GENERATION_MODELS } from "../catalog";
import { CONCEPTS } from "../graph";
import { canAnswerFromGround, groundedAnswer } from "../grounded";
import { DocsRetriever } from "../retrieval";
import type { DocsIndex } from "../types";
import { conceptPages, conceptTerms, understand } from "../understanding";

const index = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../public/assistant/docs-index.json"), "utf8")
) as DocsIndex;
const retriever = new DocsRetriever(index);

const ask = (question: string) => {
  const understanding = understand(question, { api: index.api, currentUrl: "", previous: null });
  const sections = retriever.search(question, {
    limit: 6,
    conceptTerms: conceptTerms(understanding.concepts),
    allowHistory: understanding.wantsHistory,
    conceptPages: conceptPages(understanding.concepts),
  });

  return { understanding, sections };
};

/**
 * The knowledge the ghost is expected to have.
 *
 * This used to cover a handful of concepts, which made the grounded answer a
 * small FAQ — and a FAQ is not why anyone runs a model. Every concept the
 * graph knows now carries a verified fact and its mechanisms in both
 * languages, because that content is not only the fallback: it is the
 * ESTABLISHED FACTS and HOW IT ACTUALLY WORKS block that goes into the prompt
 * for every question, which is what the model reasons from.
 */
describe("concept knowledge", () => {
  it.each(CONCEPTS.map((concept) => [concept.id, concept] as const))("%s is fully documented", (_id, concept) => {
    expect(concept.fact, "fact").toBeTruthy();
    expect(concept.factPt, "factPt").toBeTruthy();
    expect(concept.mechanisms?.length ?? 0, "mechanisms").toBeGreaterThanOrEqual(2);
    expect(concept.mechanismsPt?.length ?? 0, "mechanismsPt").toBeGreaterThanOrEqual(2);
  });

  it("says the same thing in both languages", () => {
    for (const concept of CONCEPTS) {
      expect(concept.mechanisms?.length, concept.id).toBe(concept.mechanismsPt?.length);
    }
  });

  /**
   * A fact that names something the library does not have is worse than none.
   * `migration` is the one exception, for the same reason the migration guide
   * is: naming what was removed is its entire subject.
   */
  it("names no API outside the public surface", () => {
    const known = new Set([...index.api.map((member) => member.name), "Typeof", "Strict"]);
    const offenders: string[] = [];

    for (const concept of CONCEPTS) {
      if (concept.id === "migration") continue;
      const prose = [concept.fact, concept.factPt, ...(concept.mechanisms ?? []), ...(concept.mechanismsPt ?? [])]
        .filter(Boolean)
        .join("\n");

      for (const match of prose.matchAll(/\bJIT\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
        if (!known.has(match[1])) offenders.push(`${concept.id}: JIT.${match[1]}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("the grounded answer", () => {
  it("answers the question that started all of this, in Portuguese", () => {
    const { understanding, sections } = ask("pode me explicar pq o jit é tão rapido ?");
    const answer = groundedAnswer(understanding, sections);

    expect(canAnswerFromGround(understanding)).toBe(true);
    expect(answer).toContain("uma vez, em vez de a cada chamada");
    expect(answer).toContain("Na prática:");
    expect(answer).toContain("/docs/");
    // no English leaking into a Portuguese answer
    expect(answer).not.toContain("Concretely:");
  });

  it("states the execution modes the right way round", () => {
    const { understanding, sections } = ask("qual a diferença de runtime e AOT ?");
    const answer = groundedAnswer(understanding, sections) ?? "";

    expect(answer).toContain("O motor NÃO é embarcado");
    expect(answer).not.toMatch(/biblioteca externa importada pelo cliente/);
  });

  it("answers in English when the question was English", () => {
    const { understanding, sections } = ask("why is jit so fast?");
    const answer = groundedAnswer(understanding, sections) ?? "";

    expect(answer).toContain("Concretely:");
    expect(answer).not.toContain("Na prática:");
  });

  /**
   * The floor must not become the strategy.
   *
   * Troubleshooting needs the reader's own error and their own code; nothing
   * written in advance can answer it, so those questions stay with the model
   * and fail visibly rather than getting a confident non-answer.
   */
  it("declines a question nothing written in advance can answer", () => {
    expect(canAnswerFromGround(ask("why does my parse throw?").understanding)).toBe(false);
    expect(canAnswerFromGround(ask("meu safeParse está retornando erro errado").understanding)).toBe(false);
  });

  /**
   * "pode me mostrar um exemplo de uso?" — the question that produced a JSON
   * envelope and a hundred lines of `array.push`. It is a how-to, which the
   * floor used to refuse, and it is answerable because every concept carries a
   * runnable example.
   */
  it("shows real code when the reader asks for an example", () => {
    const previous = understand("pq a jit é tão rapida ?", { api: index.api, currentUrl: "", previous: null });
    const understanding = understand("pode me mostrar um exemplo de uso?", {
      api: index.api,
      currentUrl: "",
      previous,
    });
    const sections = retriever.search(understanding.retrievalQuery, {
      limit: 6,
      conceptTerms: conceptTerms(understanding.concepts),
      conceptPages: conceptPages(understanding.concepts),
    });
    const answer = groundedAnswer(understanding, sections) ?? "";

    expect(canAnswerFromGround(understanding)).toBe(true);
    expect(answer).toContain("```ts");
    expect(answer).toContain("JIT.");
  });

  it("has something to say for every concept a reader can reach", () => {
    const unanswerable = CONCEPTS.filter((concept) => {
      const understanding = understand(concept.aliases[0] ?? concept.id, {
        api: index.api,
        currentUrl: "",
        previous: null,
      });
      return understanding.intent === "concept" && !canAnswerFromGround(understanding);
    });

    expect(unanswerable.map((concept) => concept.id)).toEqual([]);
  });
});

/**
 * The SQL query that appeared in an answer about compiling schemas. A model
 * that has lost the thread reaches for whatever its training data associates
 * with the words in front of it, and the result is a reader believing the
 * library has a database layer.
 */
describe("foreign technology in an example", () => {
  it("catches a SQL query", () => {
    const answer = "```ts\nconst user = await User.query('SELECT * FROM users WHERE id = ?', { id: 1 });\n```";

    expect(unusableExample(answer)).toContain("SQL");
  });

  it("catches an ORM and a framework", () => {
    expect(unusableExample("```ts\nconst u = await prisma.user.findMany();\n```")).toContain("ORM");
    expect(unusableExample("```ts\nconst [x, setX] = useState(1);\nJIT.object({});\n```")).toContain("framework");
  });

  it("leaves a correct jit example alone", () => {
    const answer = "```ts\nconst User = JIT.object({ id: JIT.string() });\nconst isUser = JIT.validate.is(User);\n```";

    expect(unusableExample(answer)).toBeNull();
  });

  it("says nothing when there is no code at all", () => {
    expect(unusableExample("jit compiles the schema once.")).toBeNull();
  });
});

/**
 * The model that ships by default decides more about answer quality than every
 * other choice here combined. The 0.8B navigates correctly and then explains
 * the library wrongly, which no amount of retrieval or auditing repairs.
 */
describe("the default model", () => {
  it("is the smallest one that explains correctly, not the smallest one", () => {
    expect(DEFAULT_GENERATION_MODEL.id).toBe("qwen3-1.7b");
    expect(DEFAULT_GENERATION_MODEL.id).not.toBe(GENERATION_MODELS[0].id);
  });

  it("still offers the smaller one for machines that need it", () => {
    expect(GENERATION_MODELS.map((model) => model.id)).toContain("qwen3.5-0.8b");
  });
});

/**
 * The follow-up that broke everything. "pode me mostrar um exemplo de uso?"
 * names no concept, so it used to resolve to nothing, retrieve nothing, and
 * drop the previous exchange — the model was asked to demonstrate an unnamed
 * library and answered with a JSON envelope.
 */
describe("a follow-up with no subject of its own", () => {
  const first = understand("pq a jit é tão rapida ?", { api: index.api, currentUrl: "", previous: null });
  const second = understand("pode me mostrar um exemplo de uso ?", {
    api: index.api,
    currentUrl: "",
    previous: first,
  });

  it("inherits the subject of the question before it", () => {
    expect(second.concepts.filter((match) => match.weight === 1).map((match) => match.id)).toContain("performance");
    expect(second.continuation).toBe(true);
  });

  it("searches with the inherited subject, so retrieval finds something", () => {
    expect(second.retrievalQuery).toContain("rapida");

    const sections = retriever.search(second.retrievalQuery, {
      limit: 6,
      conceptTerms: conceptTerms(second.concepts),
      conceptPages: conceptPages(second.concepts),
    });

    expect(sections.length).toBeGreaterThan(0);
  });

  /** A reader does not switch language between two messages. */
  it("keeps answering in the language the conversation is in", () => {
    expect(second.language).toBe("pt");
  });

  it("opens a new subject when the reader actually names one", () => {
    const third = understand("como mascarar PII?", { api: index.api, currentUrl: "", previous: first });

    expect(third.concepts.filter((match) => match.weight === 1).map((match) => match.id)).toContain("security");
    expect(third.continuation).toBe(false);
  });
});

/**
 * Output that came apart rather than an answer that is wrong. Both of these
 * appeared in one reply, produced when retrieval returned zero sections.
 */
describe("degeneration", () => {
  it("catches a raw JSON envelope", () => {
    const answer = '{\n  "question": "pode me mostrar um exemplo?",\n  "answer": "Sim",\n  "code": "..."\n}';

    expect(degenerated(answer)).toContain("JSON envelope");
  });

  it("catches a repetition loop", () => {
    const answer = ["```ts", "const arraysWithTypes = [];", "const arraysWithTypes = [];", "```"].join("\n");

    expect(degenerated(answer)).toContain("declared more than once");
  });

  it("catches an answer cut off inside a code block", () => {
    expect(degenerated("Here:\n\n```ts\nconst User = JIT.object({")).toContain("stops in the middle");
  });

  it("leaves an ordinary answer alone", () => {
    const answer = "jit compiles the schema once.\n\n```ts\nconst User = JIT.object({ id: JIT.string() });\n```";

    expect(degenerated(answer)).toBeNull();
  });
});

describe("concept examples", () => {
  it("gives every concept something runnable to show", () => {
    expect(CONCEPTS.filter((concept) => !concept.example).map((concept) => concept.id)).toEqual([]);
  });

  it("writes them with the real API", () => {
    const known = new Set([...index.api.map((member) => member.name), "Typeof", "Strict"]);
    const offenders: string[] = [];

    for (const concept of CONCEPTS) {
      // the migration example shows the old names in comments, on purpose
      if (concept.id === "migration") continue;
      for (const match of (concept.example ?? "").matchAll(/\bJIT\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
        if (!known.has(match[1])) offenders.push(`${concept.id}: JIT.${match[1]}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("retrieved context", () => {
  /** Six slices of one paragraph is the worst thing a small model can be given. */
  it("does not spend the context budget restating one section", () => {
    for (const question of ["why is the generated code fast?", "how does safeParse work?", "o que é a jit?"]) {
      const { sections } = ask(question);
      const texts = sections.map((source) => source.section.text);

      expect(new Set(texts).size, question).toBe(texts.length);
    }
  });
});
