import { describe, expect, it } from "vitest";
import type { LifecycleDefinition } from "../../classes/effective-schema.js";
import { lifecycleArtifact } from "../../classes/lifecycle-artifact.js";
import type { QueryNode } from "../../core/ast/index.js";
import { JIT } from "../../index.js";
import { createMapStage, createSecurityStage, createTransformStage, createUpdateStage } from "../execution-stage.js";
import { resolveNestedFactoryPolicy } from "../factory-policy-resolution.js";
import { serializeQueryNodes, serializeQueryUpdateNode } from "../query-serialization.js";
import { findRuntimeTypeSchema } from "../runtime-type/find-runtime-type-schema.js";
import { resolveRuntimeTypeOperation } from "../runtime-type/resolve-runtime-type.js";
import { hasSchemaDefault } from "../schema-default.js";

describe("schema wrapper helpers", () => {
  it("recognizes defaults through every transparent wrapper and lazy boundary", () => {
    const wrapped = [
      JIT.string().readonly(),
      JIT.string().optional(),
      JIT.string().nullable(),
      JIT.string().nullish(),
      JIT.string().brand("Name"),
      JIT.string().refine(() => true),
      JIT.string().coerce(String),
      JIT.string().pipe((value) => value),
      JIT.object({ name: JIT.string() }).transform({ name: (value) => value }),
    ];

    for (const schema of wrapped) {
      expect(hasSchemaDefault(schema.schema)).toBe(false);
    }

    expect(hasSchemaDefault(JIT.string().default("Ada").schema)).toBe(true);
    expect(hasSchemaDefault(JIT.lazy(() => JIT.string().default("Ada")).schema)).toBe(true);
    expect(hasSchemaDefault(JIT.lazy(() => JIT.string()).schema)).toBe(false);
    expect(hasSchemaDefault(JIT.string().default("Ada").readonly().schema)).toBe(true);
    expect(hasSchemaDefault(JIT.string().default("Ada").optional().schema)).toBe(true);
    expect(hasSchemaDefault(JIT.string().default("Ada").nullable().schema)).toBe(true);
    expect(hasSchemaDefault(JIT.string().default("Ada").brand("Name").schema)).toBe(true);
  });

  it("finds Runtime Types through wrappers but stops at ordinary schemas", () => {
    const Identifier = JIT.ddd.uniqueIdentifier(JIT.string().default("u_1"));
    const wrapped = JIT.readonly(JIT.optional(JIT.lazy(() => Identifier)));

    expect(findRuntimeTypeSchema(wrapped.schema)).toBe(Identifier.schema);
    expect(findRuntimeTypeSchema(JIT.string().schema)).toBeUndefined();

    const operation = resolveRuntimeTypeOperation(wrapped.schema);
    expect(operation).toMatchObject({
      schema: Identifier.schema,
      representation: "value",
      identifier: true,
      immutable: true,
    });
    expect(operation?.trustedMaterialize).toBeTypeOf("function");

    const Entity = JIT.ddd.entity(JIT.object({ owner: Identifier, name: JIT.string() }), { id: "owner" });
    expect(resolveRuntimeTypeOperation(Entity.schema)?.immutable).toBe(false);
  });
});

describe("execution stage helpers", () => {
  it("validates transform stage contracts and keeps stage descriptors stable", () => {
    const source = JIT.object({ name: JIT.string(), age: JIT.number() }).schema;
    const target = JIT.object({ name: JIT.string(), age: JIT.number() }).schema;
    const stage = createTransformStage(source, target, true, { name: (value: unknown) => String(value).trim() });

    expect(stage).toMatchObject({
      kind: "transform",
      input: "value",
      output: "value",
      many: true,
      provides: ["transformed"],
    });
    expect((stage as { readonly transforms: Record<string, unknown> }).transforms.name).toBeTypeOf("function");

    expect(() => createTransformStage(JIT.string().schema, target, false, {})).toThrow(/object source and target/);
    expect(() => createTransformStage(source, JIT.string().schema, false, {})).toThrow(/object source and target/);
    expect(() => createTransformStage(source, JIT.object({ name: JIT.string() }).schema, false, {})).toThrow(
      /field set/
    );
    expect(() =>
      createTransformStage(source, JIT.object({ name: JIT.string(), other: JIT.number() }).schema, false, {})
    ).toThrow(/field set/);
    expect(() => createTransformStage(source, target, false, { missing: () => undefined })).toThrow(/unknown field/);
    expect(() => createTransformStage(source, target, false, { name: "trim" as never })).toThrow(/must be a function/);
    expect(() => createTransformStage(source, target, false, [] as never)).toThrow(/field-to-callback/);

    expect(createMapStage(source, target, false, { name: "binding" })).toMatchObject({
      kind: "map",
      provides: ["mapped"],
      bindings: [{ name: "binding" }],
    });
    expect(createUpdateStage(source, false, { name: "Ada" })).toMatchObject({ kind: "update", provides: ["updated"] });
    expect(createSecurityStage(source, "mask", false)).toMatchObject({ kind: "security", provides: ["masked"] });
    expect(createSecurityStage(source, "sanitize", true)).toMatchObject({ kind: "security", provides: ["sanitized"] });
  });
});

describe("query serialization helpers", () => {
  it("serializes every stable query node and condition value", () => {
    const condition = {
      kind: "logical",
      op: "and",
      left: {
        kind: "compare",
        op: "gte",
        left: { kind: "field", key: "age" },
        right: { kind: "param", name: "minimum" },
      },
      right: {
        kind: "not",
        inner: {
          kind: "compare",
          op: "eq",
          left: { kind: "binding", name: "status" },
          right: { kind: "literal", value: "blocked" },
        },
      },
    } as const;
    const nodes: QueryNode[] = [
      { kind: "filter", condition },
      { kind: "select:fields", fields: ["id", "name"] },
      { kind: "aggregate", op: "count" },
      { kind: "aggregate", op: "sum", key: "amount" },
      { kind: "terminal", op: "first" },
      {
        kind: "aggregate:composite",
        fields: [
          { name: "total", op: "sum", key: "amount" },
          { name: "rows", op: "count" },
        ],
      },
      { kind: "unique", key: "id" },
      { kind: "distinct", fields: [] },
      { kind: "keyed", key: "id" },
      { kind: "groupBy", key: "status" },
      { kind: "orderBy", key: "createdAt", direction: "desc" },
      { kind: "delete" },
      { kind: "update", patch: { status: { kind: "binding", name: "nextStatus" } } },
    ];

    const serialized = serializeQueryNodes(nodes);
    expect(serialized).toContain("f(and(gte(.age,p:minimum),not(eq($status,#string:blocked)))");
    expect(serialized).toContain("a(count,)");
    expect(serialized).toContain("A(total:sum:amount,rows:count:)");
    expect(serialized).toContain("D()");
    expect(serialized).toContain("u(id)");
    expect(serialized).toContain("d()");
    expect(serialized).toContain("m(status)");

    expect(
      serializeQueryUpdateNode({ kind: "update", patch: { status: { kind: "binding", name: "nextStatus" } } })
    ).toBe("m(status=nextStatus)");
    expect(
      serializeQueryNodes([{ kind: "update", patch: {} }], (node) => `custom:${serializeQueryUpdateNode(node)}`)
    ).toBe("custom:m()");
  });
});

describe("factory policy and lifecycle helpers", () => {
  it("selects nested factory policy candidates by priority, depth, and mode", () => {
    const Either = JIT.ddd.valueObject(JIT.string()).validate({ result: "either" });
    const Tuple = JIT.ddd.valueObject(JIT.string()).validate({ result: "tuple" });
    const schema = JIT.object({ nested: Either, other: JIT.object({ deeper: Tuple }) }).schema;

    expect(resolveNestedFactoryPolicy(schema)).toMatchObject({ mode: "either", priority: 1000, depth: 1 });
    expect(resolveNestedFactoryPolicy(JIT.object({ value: JIT.string() }).schema)).toBeUndefined();
  });

  it("converts lifecycle definitions to reconstructive metadata without empty artifacts", () => {
    expect(lifecycleArtifact({})).toBeUndefined();

    const timestampClock = () => new Date(0);
    const deletionClock = () => new Date(1);
    const timestamps: NonNullable<LifecycleDefinition["timestamps"]> = {
      kind: "ddd.timestamps",
      createdAt: "createdOn",
      updatedAt: "changedOn",
      touch: "manual",
      clock: timestampClock,
      touchMethod: "markChanged",
    };
    const softDelete: NonNullable<LifecycleDefinition["softDelete"]> = {
      kind: "ddd.softDelete",
      field: "archivedOn",
      clock: deletionClock,
      deleteMethod: "archive",
      restoreMethod: "unarchive",
      isDeletedMember: "isArchived",
    };
    const versioned: NonNullable<LifecycleDefinition["versioned"]> = { kind: "ddd.versioned", field: "revision" };

    expect(lifecycleArtifact({ timestamps })).toEqual({
      touchAt: "changedOn",
      touchMethod: "markChanged",
      timestampClock,
    });
    expect(lifecycleArtifact({ softDelete })).toEqual({
      deletedAt: "archivedOn",
      deleteMethod: "archive",
      restoreMethod: "unarchive",
      isDeletedMember: "isArchived",
      deletionClock,
    });
    expect(lifecycleArtifact({ versioned })).toEqual({ version: "revision" });
    expect(lifecycleArtifact({ timestamps, softDelete, versioned })).toMatchObject({
      touchAt: "changedOn",
      deletedAt: "archivedOn",
      version: "revision",
    });
  });
});
