import { describe, expect, it } from "vitest";
import { audit, contradictions, isSevere, ungroundedClaims, unknownApiMentions, unsupportedFigures } from "../audit";
import { resolveConcepts } from "../graph";
import type { ApiMember, DocSection, RetrievedSection } from "../types";

const API: ApiMember[] = [
  { name: "validate", url: "/docs/reference/functions/validation", purpose: "is, parse" },
  { name: "object", url: "/docs/reference/functions/schema-factories", purpose: "Object" },
  { name: "compare", url: "/docs/reference/functions/equal", purpose: "equal, diff" },
];

function section(text: string): RetrievedSection {
  const doc: DocSection = {
    url: "/docs/concepts/compilation-model#why",
    page: "Compilation model",
    description: "",
    heading: "Why the generated path is fast",
    breadcrumb: "Compilation model › Why the generated path is fast",
    kind: "concept",
    depth: 2,
    part: 0,
    text,
  };

  return { section: doc, score: 1, lexical: 1, semantic: 0 };
}

describe("unknownApiMentions", () => {
  /** Exactly what a 0.8B model produced when asked to help build a schema. */
  it("catches a namespace member the library does not have", () => {
    expect(unknownApiMentions("Use `JIT.createSchema({})`.", API)).toContain("JIT.createSchema");
  });

  it("says nothing about an answer that stays inside the surface", () => {
    expect(unknownApiMentions("JIT.object({}) then JIT.validate.is(User)", API)).toEqual([]);
  });

  it("verifies the namespace, not the method hanging off it", () => {
    expect(unknownApiMentions("JIT.validate.safeParse(input)", API)).toEqual([]);
  });

  it("leaves namespaces the index does not enumerate alone", () => {
    expect(unknownApiMentions("AOT.defineConfig({})", API)).toEqual([]);
  });

  /**
   * Type-level exports are real but invisible to `Object.keys(JIT)`, and
   * `JIT.Typeof` appears on the first page of the quick start — flagging it
   * would teach readers that this banner is noise.
   */
  it("accepts the type-level exports the runtime cannot enumerate", () => {
    expect(unknownApiMentions("type User = JIT.Typeof<typeof UserSchema>;", API)).toEqual([]);
    expect(unknownApiMentions("JIT.Strict<typeof User, T>", API)).toEqual([]);
  });

  it("says nothing before the index has loaded", () => {
    expect(unknownApiMentions("JIT.createSchema({})", [])).toEqual([]);
  });
});

describe("unsupportedFigures", () => {
  const sources = [section("safeParse is roughly 18% faster on valid values, at 43.94 ns.")];

  it("accepts a figure the sections actually contain", () => {
    expect(unsupportedFigures("It is 18% faster.", sources)).toEqual([]);
    expect(unsupportedFigures("Around 43.94 ns per call.", sources)).toEqual([]);
  });

  /** The prompt forbids inventing a benchmark; this notices when it happens. */
  it("catches a figure that appears in no section", () => {
    expect(unsupportedFigures("It is about 400x faster than zod.", sources)).toEqual(["400x"]);
  });

  it("ignores an answer with no figures in it", () => {
    expect(unsupportedFigures("It compiles the schema once.", sources)).toEqual([]);
  });

  it("says nothing when there were no sections to check against", () => {
    expect(unsupportedFigures("It is 400x faster.", [])).toEqual([]);
  });
});

describe("contradictions", () => {
  const concepts = resolveConcepts("pq a jit é rapida?");

  /** Said twice by the 0.8B model, in both languages. */
  it("catches an answer that denies the fact it was given", () => {
    expect(contradictions("O jit não é mais rápido que uma função nativa.", concepts)).toHaveLength(1);
    expect(contradictions("The library is not faster than a plain function.", concepts)).toHaveLength(1);
    expect(contradictions("Ele foi projetado para ser mais lento.", concepts)).toHaveLength(1);
  });

  it("leaves an answer that agrees with the fact alone", () => {
    expect(contradictions("It is fast because the schema is walked once at compile time.", concepts)).toEqual([]);
  });

  /** A fact reached through an edge was never established for this question. */
  it("only checks concepts the reader named", () => {
    expect(contradictions("não é mais rápido", resolveConcepts("how do I clone an object?"))).toEqual([]);
  });
});

describe("ungroundedClaims", () => {
  const evidence =
    "jit walks the schema once at compile time and emits specialized straight-line JavaScript. Checks are ordered cheapest-first: typeof, then null, then numeric, then length, then regex.";

  it("accepts a claim the evidence supports, however it is phrased", () => {
    expect(ungroundedClaims("The schema is walked once at compile time, so checks stay cheap.", evidence)).toEqual([]);
  });

  /** The shape of the answer that started this: confident, technical, invented. */
  it("catches a technical claim nothing supports", () => {
    const answer = "It runs directly in the operating system memory and avoids interpolation of memory pages.";

    expect(ungroundedClaims(answer, evidence)).toHaveLength(1);
  });

  it("leaves framing and short sentences alone", () => {
    expect(ungroundedClaims("Sure, here you go.", evidence)).toEqual([]);
    expect(ungroundedClaims("That depends on what you need.", evidence)).toEqual([]);
  });

  it("only judges sentences that assert something technical", () => {
    const answer = "I would reach for the second option here, because it reads better to most people on a team.";

    expect(ungroundedClaims(answer, evidence)).toEqual([]);
  });

  it("says nothing when there was no evidence to judge against", () => {
    expect(ungroundedClaims("It runs in operating system memory.", "")).toEqual([]);
  });
});

describe("audit", () => {
  const context = {
    api: API,
    sections: [section("safeParse is roughly 18% faster on valid values.")],
    concepts: resolveConcepts("pq a jit é rapida?"),
  };

  it("passes an answer that is grounded, named correctly and numerically honest", () => {
    const answer = "It compiles once, so it is fast — around 18% on valid values [1]. Use JIT.validate.is.";

    expect(audit(answer, context)).toEqual([]);
  });

  it("counts the facts it was handed as evidence, not as invention", () => {
    const established = ["The speed comes from doing the schema work once instead of per call."];
    const answer = "The speed comes from doing the schema work once instead of per call, not on every request.";

    expect(audit(answer, { ...context, established })).toEqual([]);
  });

  it("reports every kind of problem in one answer", () => {
    const answer = "O jit não é mais rápido. Use JIT.createSchema para ganhar 400x.";
    const kinds = audit(answer, context).map((finding) => finding.kind);

    expect(kinds).toContain("contradiction");
    expect(kinds).toContain("invented-api");
    expect(kinds).toContain("unsupported-number");
  });
});

describe("isSevere", () => {
  /**
   * A warning placed under something the reader already believed arrives too
   * late, so the two findings that make an answer actively misleading are
   * announced above it and the two that make it merely thin are not.
   */
  it("treats an invented name and a denied fact as read-this-first", () => {
    expect(isSevere({ kind: "invented-api", names: ["JIT.createSchema"] })).toBe(true);
    expect(isSevere({ kind: "contradiction", claim: "it is fast" })).toBe(true);
  });

  it("treats a thin claim as a footnote", () => {
    expect(isSevere({ kind: "unsupported-number", values: ["400x"] })).toBe(false);
    expect(isSevere({ kind: "ungrounded-claim", sentences: ["…"] })).toBe(false);
  });
});
