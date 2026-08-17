import { describe, expect, it } from "vitest";
import { apiSurface, contextBlock, foldSystemIntoFirstTurn, systemPrompt, userTurn } from "../prompt";
import type { ApiMember, DocSection, RetrievedSection } from "../types";
import type { Understanding } from "../understanding";

function section(overrides: Partial<DocSection> = {}): RetrievedSection {
  return {
    section: {
      url: "/docs/reference/functions/validation#validate",
      page: "validate",
      description: "Create callable validation artifacts.",
      heading: "validate",
      breadcrumb: "validate › validate",
      kind: "reference",
      depth: 2,
      part: 0,
      text: "JIT.validate.is(User) returns a type predicate that never allocates.",
      ...overrides,
    },
    score: 1,
    lexical: 1,
    semantic: 0,
  };
}

describe("contextBlock", () => {
  it("numbers sections so the citation rule has something to point at", () => {
    const block = contextBlock([section(), section({ heading: "safeParse", url: "/docs/x#safeparse" })]);

    expect(block).toContain("[1] validate — validate (/docs/reference/functions/validation#validate)");
    expect(block).toContain("[2] validate — safeParse (/docs/x#safeparse)");
  });

  it("drops whole sections rather than cutting one mid-sentence", () => {
    const long = section({ text: "x".repeat(5000) });
    const second = section({ text: "y".repeat(5000), heading: "second" });

    const block = contextBlock([long, second]);

    expect(block).toContain("x".repeat(5000));
    expect(block).not.toContain("yyy");
  });

  it("truncates when even the first section does not fit", () => {
    const block = contextBlock([section({ text: "z".repeat(20_000) })]);

    expect(block.length).toBeLessThanOrEqual(6000);
    expect(block).toContain("[1]");
  });

  it("is empty when nothing was retrieved", () => {
    expect(contextBlock([])).toBe("");
  });
});

describe("userTurn", () => {
  it("puts the context before the question and names the page being read", () => {
    const turn = userTurn({ question: "how do I validate?", sections: [section()], currentUrl: "/docs/quick-start" });

    expect(turn.indexOf("DOCUMENTATION SECTIONS")).toBeLessThan(turn.indexOf("QUESTION:"));
    expect(turn).toContain("The reader is on /docs/quick-start.");
    expect(turn).toContain("QUESTION: how do I validate?");
  });

  it("says so explicitly when retrieval found nothing", () => {
    const turn = userTurn({ question: "what is a monad?", sections: [], currentUrl: "" });

    expect(turn).toContain("(none matched this question)");
    expect(turn).not.toContain("The reader is on");
  });
});

describe("system prompt", () => {
  it("forbids answering from memory and requires citations", () => {
    const prompt = systemPrompt();

    expect(prompt).toContain("ONLY from the DOCUMENTATION SECTIONS");
    expect(prompt).toContain("They are the truth");
    expect(prompt).toContain("[1], [2]");
  });

  it("rides on the first turn for models with no system role", () => {
    const folded = foldSystemIntoFirstTurn("QUESTION: hi");

    expect(folded.startsWith(systemPrompt())).toBe(true);
    expect(folded).toContain("QUESTION: hi");
  });
});

const API: ApiMember[] = [
  { name: "validate", url: "/docs/reference/functions/validation", purpose: "is, parse, safeParse" },
  { name: "map", url: "/docs/reference/functions/mapper", purpose: "Whitelist mapping" },
  { name: "mapSchema", url: "/docs/reference/functions/schema-factories", purpose: "Map schema" },
];

describe("apiSurface", () => {
  it("lists every member with its purpose", () => {
    const surface = apiSurface(API);

    expect(surface).toContain("JIT.validate — is, parse, safeParse");
    expect(surface).toContain("JIT.map — Whitelist mapping");
  });

  /** The whole reason it is carried: a name that is not on the list is invented. */
  it("tells the model the list is exhaustive", () => {
    expect(apiSurface(API)).toContain("Never use a name that is not in this list");
  });

  it("says nothing when the index has not loaded yet", () => {
    expect(apiSurface([])).toBe("");
  });
});

describe("system prompt grounding", () => {
  it("carries the facts that hold on every page", () => {
    const prompt = systemPrompt(API);

    expect(prompt).toContain("never interprets a schema at call time");
    // the removal is stated as a rule, not by naming what was removed
    expect(prompt).toContain("If a name is not in the API list, it does not exist");
    expect(prompt).toContain("@jit-compiler/jit/define");
  });

  it("carries the API surface alongside them", () => {
    expect(systemPrompt(API)).toContain("JIT.mapSchema");
  });

  it("still works before the index arrives", () => {
    const prompt = systemPrompt();

    expect(prompt).toContain("You are the jit ghost");
    expect(prompt).not.toContain("Never use a name that is not in this list");
  });

  it("folds the whole grounding into the first turn for a template with no system role", () => {
    const folded = foldSystemIntoFirstTurn("QUESTION: hi", API);

    expect(folded).toContain("JIT.mapSchema");
    expect(folded).toContain("QUESTION: hi");
  });
});

const understanding = (overrides: Partial<Understanding> = {}): Understanding => ({
  language: "en",
  intent: "concept",
  wantsHistory: false,
  asksToNavigate: false,
  solutions: [],
  relatedPages: [],
  concepts: [],
  apis: [],
  aboutTheLibrary: false,
  continuation: false,
  shouldNavigate: false,
  ...overrides,
});

describe("turn framing", () => {
  /**
   * The failure this exists for: without it the model reads "jit" as
   * just-in-time compilation, explains JavaScript engines, and invents
   * `JIT.js` and `JIT.exe`.
   */
  it("states that jit is this library when the question is about it", () => {
    const turn = userTurn({
      question: "why is jit fast?",
      sections: [],
      currentUrl: "/docs",
      understanding: understanding({ aboutTheLibrary: true }),
    });

    expect(turn).toContain("@jit-compiler/jit");
    // Stated positively on purpose. The anchor used to be a list of negations
    // — "not a JavaScript engine, no jit.js or jit.exe" — and a small model
    // handed negations recites them: "a jit não é uma linguagem de execução
    // que roda sobre o sistema operacional" was this instruction, read back.
    expect(turn).toContain("never what it is not");
    expect(turn).not.toMatch(/jit\.js|jit\.exe/);
  });

  it("says nothing about identity when the question is not about the library", () => {
    const turn = userTurn({
      question: "how do I clone an object?",
      sections: [],
      currentUrl: "/docs",
      understanding: understanding(),
    });

    expect(turn).not.toContain("means THIS library");
  });

  it("asks for the shape of answer the question wants", () => {
    const howto = userTurn({
      question: "how do I validate?",
      sections: [],
      currentUrl: "",
      understanding: understanding({ intent: "howto" }),
    });

    expect(howto).toContain("Give the steps");
  });

  it("names the APIs the reader asked about", () => {
    const turn = userTurn({
      question: "what does jsonSchema do?",
      sections: [],
      currentUrl: "",
      understanding: understanding({ apis: ["jsonSchema"] }),
    });

    expect(turn).toContain("JIT.jsonSchema");
  });

  it("tells the model to answer in the language it was asked in", () => {
    const turn = userTurn({
      question: "como valido?",
      sections: [],
      currentUrl: "",
      understanding: understanding({ language: "pt" }),
    });

    expect(turn).toContain("Answer in Portuguese");
  });
});

describe("answer shape", () => {
  /** A "why" question answered with "Sim, ..." is agreeing with nothing. */
  it("forbids opening with a yes or a no on a question that asked neither", () => {
    expect(systemPrompt()).toContain('Never open with "Yes", "No", "Sim" or "Não"');
  });
});

describe("prompt budget", () => {
  const api: ApiMember[] = Array.from({ length: 74 }, (_, index) => ({
    name: `member${index}`,
    url: "/docs/reference/functions/index",
    purpose: "does a thing",
  }));

  /**
   * The list is a fifth of the prompt. On "why is jit fast" that is 480 tokens
   * competing with the documentation for a small model's attention.
   */
  it("leaves the API list out of a question that names no API", () => {
    const prompt = systemPrompt(api, understanding({ intent: "concept" }));

    expect(prompt).not.toContain("member7");
    expect(prompt).toContain("never interprets a schema at call time");
  });

  it("includes it when the reader named an API", () => {
    expect(systemPrompt(api, understanding({ apis: ["member7"] }))).toContain("member7");
  });

  it("includes it for a how-to, where the answer is code", () => {
    expect(systemPrompt(api, understanding({ intent: "howto" }))).toContain("member7");
  });

  it("keeps it when nothing is known about the question", () => {
    expect(systemPrompt(api)).toContain("member7");
  });
});

describe("established facts", () => {
  it("puts the verified reason in front of the question", () => {
    const turn = userTurn({
      question: "why is jit fast?",
      sections: [],
      currentUrl: "/docs",
      understanding: understanding({
        aboutTheLibrary: true,
        concepts: [{ id: "performance", weight: 1 }],
      }),
    });

    expect(turn).toContain("ESTABLISHED FACTS");
    expect(turn).toContain("doing the schema work once instead of per call");
    expect(turn.indexOf("ESTABLISHED FACTS")).toBeLessThan(turn.indexOf("QUESTION:"));
  });
});

describe("legacy sections", () => {
  const legacy = (): RetrievedSection => ({
    section: {
      url: "/docs/guides/migrating-to-2#validators",
      page: "Migrating to 2.0",
      description: "",
      heading: "Validators",
      breadcrumb: "Migrating to 2.0 › Validators",
      kind: "history",
      depth: 2,
      part: 0,
      showsRemovedApis: true,
      text: "// 1.x\nconst Users = JIT.validator(User);",
    },
    score: 1,
    lexical: 1,
    semantic: 0,
  });

  /**
   * The migration guide quotes removed APIs on purpose, and a chunk of it can
   * lose the "// 1.x" comment that framed them. Unlabelled, the model reads
   * `JIT.validator` as ordinary code and writes it back out.
   */
  it("labels a section that quotes removed APIs", () => {
    const block = contextBlock([legacy()]);

    expect(block).toContain("WARNING: quotes APIs REMOVED in 2.0");
    expect(block).toContain("Never write a name from this section");
  });

  it("leaves an ordinary section unlabelled", () => {
    const block = contextBlock([section()]);

    expect(block).not.toContain("WARNING");
  });
});

describe("system prompt hygiene", () => {
  /**
   * Naming a removed API to forbid it makes it salient: a small model reading
   * "there is no JIT.serializer()" emits `JIT.serialize`. The rule is stated
   * positively instead.
   */
  it.each([
    "JIT.validator",
    "JIT.serializer",
    "JIT.mapper",
    "JIT.model(",
  ])("never mentions %s, even to forbid it", (removed) => {
    expect(systemPrompt()).not.toContain(removed);
  });

  it("states the rule positively", () => {
    expect(systemPrompt()).toContain("If a name is not in the API list, it does not exist");
  });
});
