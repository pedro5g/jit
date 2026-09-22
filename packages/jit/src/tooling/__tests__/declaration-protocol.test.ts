import {
  type AgentDeclaration,
  applyDeclarationPatch,
  createDeclarationProject,
  declarationScope,
  RevisionConflictError,
  validateDeclarationProject,
} from "../declaration-protocol.js";

const UserId: AgentDeclaration = {
  kind: "valueObject",
  schema: { type: "string", checks: [{ kind: "uuid" }] },
  module: "value-objects",
  identity: true,
};

const User: AgentDeclaration = {
  kind: "entity",
  schema: {
    type: "object",
    fields: {
      id: { type: "ref", name: "UserId" },
      name: { type: "string", checks: [{ kind: "min", value: 2 }] },
    },
  },
  module: "entities",
};

describe("Declaration Protocol v1", () => {
  it("creates a revisioned project and applies an optimistic patch", () => {
    const initial = createDeclarationProject({ UserId, User }, ["value-objects", "entities"]);
    const next = applyDeclarationPatch(initial, {
      version: 1,
      baseRevision: initial.revision,
      operations: [
        {
          op: "create",
          name: "Account",
          declaration: {
            kind: "entity",
            schema: { type: "object", fields: { owner: { type: "ref", name: "User" } } },
            module: "entities",
          },
        },
      ],
    });

    expect(next.revision).not.toBe(initial.revision);
    expect(Object.keys(next.declarations)).toEqual(["UserId", "User", "Account"]);
    expect(declarationScope(next, "User").declarations).toEqual({ User });
    expect(() => validateDeclarationProject(next)).not.toThrow();
  });

  it("renames references transactionally and rejects stale writes", () => {
    const initial = createDeclarationProject({ UserId, User }, ["value-objects", "entities"]);
    const renamed = applyDeclarationPatch(initial, {
      version: 1,
      baseRevision: initial.revision,
      operations: [{ op: "rename", from: "UserId", to: "AccountId" }],
    });

    expect(renamed.declarations.AccountId).toBeDefined();
    expect(
      (
        renamed.declarations.User.schema as {
          readonly fields: Record<string, { readonly type: string; readonly name?: string }>;
        }
      ).fields.id
    ).toEqual({
      type: "ref",
      name: "AccountId",
    });
    expect(() =>
      applyDeclarationPatch(initial, { version: 1, baseRevision: renamed.revision, operations: [] })
    ).toThrow(RevisionConflictError);
  });

  it("rejects unresolved references before a model revision is created", () => {
    expect(() =>
      createDeclarationProject({
        Broken: { kind: "schema", schema: { type: "ref", name: "Missing" } },
      })
    ).toThrow(/missing declaration/);
  });
});
