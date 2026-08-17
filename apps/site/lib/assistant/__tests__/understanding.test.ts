import { describe, expect, it } from "vitest";
import { conceptForApi, resolveConcepts, SELF_NODE } from "../graph";
import type { ApiMember } from "../types";
import {
  classifyIntent,
  detectLanguage,
  groundTruth,
  isContinuation,
  mentionedApis,
  understand,
} from "../understanding";

const API: ApiMember[] = [
  { name: "validate", url: "/docs/reference/functions/validation", purpose: "is, parse" },
  { name: "map", url: "/docs/reference/functions/mapper", purpose: "Mapper" },
  { name: "jsonSchema", url: "/docs/reference/functions/json-schema", purpose: "Bridge" },
  { name: "object", url: "/docs/reference/functions/schema-factories", purpose: "Object" },
];

const ask = (question: string, currentUrl = "/docs") => understand(question, { api: API, currentUrl, previous: null });

describe("resolveConcepts", () => {
  /**
   * The failure this graph exists for: without an identity node the model
   * answers about just-in-time compilation, invents `JIT.js`, and sounds sure.
   */
  it("recognises that a question about jit is about this library", () => {
    expect(resolveConcepts("pq o jit é tão rápido?").map((match) => match.id)).toContain(SELF_NODE);
    expect(resolveConcepts("me ajuda com essa lib").map((match) => match.id)).toContain(SELF_NODE);
  });

  it("reaches neighbours of what was named, at a lower weight", () => {
    const matches = resolveConcepts("why is it fast");
    const performance = matches.find((match) => match.id === "performance");
    const compilation = matches.find((match) => match.id === "compilation");

    expect(performance?.weight).toBe(1);
    expect(compilation?.weight).toBeLessThan(1);
    expect(compilation?.weight).toBeGreaterThan(0);
  });

  it("matches whole words only", () => {
    // "lab" must not fire on "collaborate", "vs" must not fire on "vscode"
    expect(resolveConcepts("we collaborate on this").map((match) => match.id)).not.toContain("workspace");
    expect(resolveConcepts("in vscode").map((match) => match.id)).not.toContain("comparison");
  });

  /**
   * Portuguese agrees in gender and number, so a reader writes "rapida",
   * "rapido" or "rapidas" for the same idea. Exact-string aliases matched only
   * one of them, and "pq a jit é rapida?" silently resolved to no concept at
   * all — no ground truth, and retrieval left to guess.
   */
  it.each([
    "pq a jit é rapida?",
    "pq o jit é rapido?",
    "as consultas sao rapidas?",
    "why is it fast?",
  ])("resolves %s to performance whatever the agreement", (question) => {
    expect(resolveConcepts(question).map((match) => match.id)).toContain("performance");
  });

  it("puts the concept asked about ahead of the library itself", () => {
    const ids = resolveConcepts("pq a jit é rapida?").map((match) => match.id);

    expect(ids.indexOf("performance")).toBeLessThan(ids.indexOf(SELF_NODE));
  });

  it("resolves both languages to the same concept", () => {
    const english = resolveConcepts("how do I mask pii").map((match) => match.id);
    const portuguese = resolveConcepts("como mascarar dados sensíveis").map((match) => match.id);

    expect(english).toContain("security");
    expect(portuguese).toContain("security");
  });

  it("knows which concept owns an API member", () => {
    expect(conceptForApi("validate")).toBe("validation");
    expect(conceptForApi("jsonSchema")).toBe("jsonschema");
  });
});

describe("detectLanguage", () => {
  it("settles it on accents", () => {
    expect(detectLanguage("pq o jit é rápido?")).toBe("pt");
  });

  it("falls back to function words when accents are dropped", () => {
    expect(detectLanguage("como faco para validar")).toBe("pt");
  });

  it("leaves English alone", () => {
    expect(detectLanguage("how do I validate a payload")).toBe("en");
    expect(detectLanguage("what replaced JIT.validator")).toBe("en");
  });
});

describe("classifyIntent", () => {
  it.each([
    ["how do I validate a payload?", "howto"],
    ["como escrevo um schema?", "howto"],
    ["why is the generated code fast?", "concept"],
    ["o que é um DTO?", "concept"],
    ["jit vs zod", "compare"],
    ["safeParse throws an error, why?", "troubleshoot"],
    // asked exactly this way by a reader; "pq o" alone is not a failure report
    ["cara pq o jit é toa rapido ?", "concept"],
  ])("reads %s as %s", (question, intent) => {
    expect(classifyIntent(question, [])).toBe(intent);
  });

  it("reads a bare API name as a question about that API", () => {
    expect(classifyIntent("JIT.jsonSchema", ["jsonSchema"])).toBe("api");
  });
});

describe("mentionedApis", () => {
  it("finds a namespaced mention", () => {
    expect(mentionedApis("what does JIT.validate do?", API)).toEqual(["validate"]);
  });

  it("finds a distinctive bare name", () => {
    expect(mentionedApis("can jsonSchema read openapi?", API)).toEqual(["jsonSchema"]);
  });

  /** "map" and "object" are ordinary words; matching them bare would fire everywhere. */
  it("ignores a short name used as an ordinary word", () => {
    expect(mentionedApis("I want to map an object to a DTO", API)).toEqual([]);
  });
});

describe("isContinuation", () => {
  const previous = ask("how do I mask pii before logging?");

  it("continues when the new question leans on the last one", () => {
    expect(
      isContinuation(resolveConcepts("e isso funciona com arrays?"), previous, "e isso funciona com arrays?")
    ).toBe(true);
  });

  it("continues when both questions are about the same concept", () => {
    expect(isContinuation(resolveConcepts("can I sanitize instead?"), previous, "can I sanitize instead?")).toBe(true);
  });

  /**
   * A model handed an unrelated previous exchange keeps answering that one,
   * so an unrelated question has to arrive with the history dropped.
   */
  it("opens a new subject when nothing is shared", () => {
    const question = "how do I generate an import-free module?";

    expect(isContinuation(resolveConcepts(question), previous, question)).toBe(false);
  });

  it("never treats the first question as a continuation", () => {
    expect(isContinuation(resolveConcepts("anything"), null, "anything")).toBe(false);
  });
});

describe("understand", () => {
  /**
   * Every question typed into the panel is about this library — the reader is
   * standing in its documentation. This used to wait for the word "jit" to
   * appear, which left the identity anchor off most prompts, and a small model
   * with no anchor answers about just-in-time compilation in general.
   */
  it("treats every question as being about the library", () => {
    expect(ask("por que o jit é tão rápido?").aboutTheLibrary).toBe(true);
    expect(ask("how do I clone an object?").aboutTheLibrary).toBe(true);
  });

  it("suggests where to go, and says so only when the reader is elsewhere", () => {
    expect(ask("how do I mask pii?", "/docs").shouldNavigate).toBe(true);
    expect(ask("how do I mask pii?", "/docs/reference/functions/mask").shouldNavigate).toBe(false);
  });

  it("carries the language through, so the answer matches the question", () => {
    expect(ask("como valido um payload?").language).toBe("pt");
  });
});

describe("groundTruth", () => {
  /**
   * The failure this exists for: retrieval hands the model a list of
   * mechanisms ("arrays use indexed loops") and it concludes that jit is not
   * fast. The reason has to be stated, not inferred.
   */
  it("states why jit is fast when that is the question", () => {
    const facts = groundTruth(resolveConcepts("pq o jit é tão rápido?"));

    expect(facts.join(" ")).toContain("doing the schema work once instead of per call");
  });

  it("says what the library is when the question is about the library", () => {
    expect(groundTruth(resolveConcepts("o que é o jit?")).join(" ")).toContain("schema-first data engine");
  });

  /** A fact reached through an edge is a guess about relevance, not knowledge. */
  it("only speaks for concepts the reader named", () => {
    const facts = groundTruth(resolveConcepts("why is it fast"));

    expect(facts.join(" ")).toContain("doing the schema work once");
    // compilation is a neighbour here, not a named concept
    expect(facts.join(" ")).not.toContain("monomorphic straight-line code");
  });

  it("stays short enough to sit in front of a small model", () => {
    expect(groundTruth(resolveConcepts("jit validation aot query security")).length).toBeLessThanOrEqual(3);
  });

  it("says nothing when the question matched no concept", () => {
    expect(groundTruth([])).toEqual([]);
  });
});
