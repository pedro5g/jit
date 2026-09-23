import { createSchema, TypeName } from "../../../core/ats/index.js";
import { Compiler, JIT } from "../../../index.js";
import { normalizeConstraints } from "../constraint-model.js";
import { deriveSchemaFacts } from "../schema-facts.js";

describe("constraint normalization", () => {
  it("normalizes equivalent checks independently of declaration order", () => {
    const left = normalizeConstraints(JIT.string().min(3).max(10).length(5).schema);
    const right = normalizeConstraints(JIT.string().length(5).max(10).min(3).schema);

    expect(left.length).toEqual(right.length);
    expect(left.length).toMatchObject({ exact: 5, minimum: 5, maximum: 5 });
  });

  it("derives cardinality, enum, literal, and structural facts", () => {
    const Row = JIT.object({
      state: JIT.enum({ Draft: "draft", Published: "published" }),
      tag: JIT.literal("user"),
      values: JIT.array(JIT.string()).length(2),
    });
    const facts = deriveSchemaFacts(Row.schema);

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "StableShape" }),
        expect.objectContaining({ kind: "KnownField", path: ["state"] }),
        expect.objectContaining({ kind: "ExactCardinality", path: ["values"], exact: 2 }),
      ])
    );
  });

  it("keeps proven collection capabilities in semantic facts", () => {
    const Users = JIT.array(JIT.object({ id: JIT.string() }))
      .uniqueBy("id")
      .indexBy("id")
      .ordered("id")
      .hash("ordered");
    const facts = deriveSchemaFacts(Users.schema);

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "UniqueBy", value: "id" }),
        expect.objectContaining({ kind: "IndexedBy", value: "id" }),
        expect.objectContaining({ kind: "OrderedBy", value: "id" }),
        expect.objectContaining({ kind: "HashedBy", value: "ordered" }),
      ])
    );
  });
});

describe("constraint contradictions", () => {
  it("rejects impossible constraints before generated validation executes", () => {
    const Impossible = JIT.string().min(8).length(5);
    const isImpossible = JIT.validate.is(Impossible);

    expect(() => isImpossible("12345")).toThrowError(expect.objectContaining({ code: "UNSATISFIABLE_SCHEMA" }));
  });

  it("intersects explicit tuple bounds with structural cardinality", () => {
    const Impossible = createSchema(TypeName.tuple, {
      items: [JIT.string().schema, JIT.number().schema] as const,
      rest: undefined,
      checks: [{ kind: "max", value: 1 }],
    });

    expect(() => JIT.validate.is(Impossible)(["a", 1])).toThrowError(
      expect.objectContaining({ code: "UNSATISFIABLE_SCHEMA" })
    );
    expect(() => Compiler.emitValidatorSource(Impossible, { ops: ["is"] })).toThrowError(
      expect.objectContaining({ code: "UNSATISFIABLE_SCHEMA" })
    );
  });
});

describe("constraint execution boundaries", () => {
  it("infers normalized facts only after the validation boundary", () => {
    const User = JIT.object({ id: JIT.int().min(1), name: JIT.string() });
    const analysis = Compiler.analyzeExecutionPlan(JIT.json.parse(User).validate().plan);
    const before = analysis.find(({ stage }) => stage.kind === "json.decode");
    const after = analysis.find(({ stage }) => stage.kind === "validate");

    expect(before?.factsAfter).toEqual([]);
    expect(after?.factsAfter).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "Validated" }),
        expect.objectContaining({ kind: "StableShape" }),
        expect.objectContaining({ kind: "KnownField", path: ["name"] }),
      ])
    );
  });
});
