import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeclarationProject } from "../declaration-protocol.js";
import { createModelToolCore } from "../model-tools.js";

const REFERENCED_DECLARATIONS = [
  { op: "create", name: "UserId", declaration: { kind: "schema", schema: { type: "string" } } },
  {
    op: "create",
    name: "User",
    declaration: {
      kind: "schema",
      schema: { type: "object", fields: { id: { type: "ref", name: "UserId" } } },
    },
  },
] as const;
const UPDATED_USER_ID = [
  {
    op: "update",
    name: "UserId",
    declaration: { kind: "schema", schema: { type: "string", checks: [{ kind: "uuid" }] } },
  },
] as const;

function useTemporaryProject(): () => string {
  let root = "";
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "jit-agent-model-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });
  return () => root;
}

describe("agent declaration model tools", () => {
  const projectRoot = useTemporaryProject();

  it("applies a structured model patch and compiles through the existing AOT host", async () => {
    const root = projectRoot();
    const core = createModelToolCore();
    const initial = createDeclarationProject();
    const applied = await core.execute(
      "jit_model_apply",
      {
        baseRevision: initial.revision,
        operations: [
          {
            op: "create",
            name: "User",
            declaration: {
              kind: "schema",
              module: "contracts",
              schema: {
                type: "object",
                fields: {
                  id: { type: "number", checks: [{ kind: "int" }] },
                  name: { type: "string", checks: [{ kind: "min", value: 2 }] },
                },
              },
            },
          },
        ],
      },
      { root }
    );
    const revision = (applied.data as { readonly revision: string }).revision;
    const compiled = await core.execute("jit_compile", { naming: "semantic" }, { root });

    expect(revision).toMatch(/^R[0-9a-f]{12}$/);
    expect(compiled.data).toMatchObject({ status: "success", revision, files: 2, metadataFiles: 2, symbols: 3 });
    expect(existsSync(join(root, "generated", "contracts", "User.ts"))).toBe(true);
    expect(existsSync(join(root, "generated", "index.ts"))).toBe(true);
    expect(JSON.parse(readFileSync(join(root, "generated", "jit.manifest.json"), "utf8"))).toMatchObject({
      ownership: "managed",
      emission: { naming: "semantic" },
    });
  });

  it("returns a filtered model without exposing unrelated declarations", async () => {
    const root = projectRoot();
    const core = createModelToolCore();
    const initial = createDeclarationProject();
    await core.execute(
      "jit_model_apply",
      {
        baseRevision: initial.revision,
        operations: [
          { op: "create", name: "User", declaration: { kind: "schema", schema: { type: "string" } } },
          { op: "create", name: "Order", declaration: { kind: "schema", schema: { type: "number" } } },
        ],
      },
      { root }
    );
    const result = await core.execute("jit_model_get", { scope: "User" }, { root });

    expect(result.data).toMatchObject({ declarations: { User: { kind: "schema" } } });
    expect(JSON.stringify(result.data)).not.toContain("Order");
  });
});

describe("agent declaration DDD materialization", () => {
  const projectRoot = useTemporaryProject();

  it("materializes declared entity identity and DDD extensions through the existing class host", async () => {
    const root = projectRoot();
    const core = createModelToolCore();
    const initial = createDeclarationProject();
    const applied = await core.execute(
      "jit_model_apply",
      {
        baseRevision: initial.revision,
        operations: [
          { op: "createModule", module: "domain/entities" },
          {
            op: "create",
            name: "User",
            declaration: {
              kind: "entity",
              module: "domain/entities",
              identity: "id",
              extends: [{ capability: "timestamps" }],
              schema: { type: "object", fields: { id: { type: "string" }, name: { type: "string" } } },
            },
          },
        ],
      },
      { root }
    );

    await core.execute("jit_compile", { format: "js" }, { root });
    const manifest = JSON.parse(readFileSync(join(root, "generated", "jit.manifest.json"), "utf8")) as {
      readonly symbols: readonly {
        readonly name: string;
        readonly kind: string;
        readonly capabilities: readonly string[];
      }[];
    };
    const user = manifest.symbols.find((symbol) => symbol.name === "User");

    expect(applied.data).toMatchObject({ status: "success" });
    expect(user).toMatchObject({ kind: "class" });
    expect(user?.capabilities).toContain("ddd.timestamps");
  });

  it("uses identity metadata from a structured Value Object for entity inference", async () => {
    const root = projectRoot();
    const core = createModelToolCore();
    const initial = createDeclarationProject();
    await core.execute(
      "jit_model_apply",
      {
        baseRevision: initial.revision,
        operations: [
          {
            op: "create",
            name: "UserId",
            declaration: { kind: "valueObject", identity: true, schema: { type: "string" } },
          },
          {
            op: "create",
            name: "User",
            declaration: {
              kind: "entity",
              schema: { type: "object", fields: { id: { type: "ref", name: "UserId" } } },
            },
          },
        ],
      },
      { root }
    );

    const compiled = await core.execute("jit_compile", { format: "js" }, { root });

    expect(compiled.data).toMatchObject({ status: "success" });
    expect(readFileSync(join(root, "generated", "User.js"), "utf8")).toContain("class User");
  });
});

describe("agent declaration ownership", () => {
  const projectRoot = useTemporaryProject();

  it("records detached ownership when the agent hands the generated tree off", async () => {
    const root = projectRoot();
    const core = createModelToolCore();
    const initial = createDeclarationProject();
    await core.execute(
      "jit_model_apply",
      {
        baseRevision: initial.revision,
        operations: [
          { op: "createModule", module: "contracts" },
          {
            op: "create",
            name: "User",
            declaration: { kind: "schema", module: "contracts", schema: { type: "string" } },
          },
        ],
      },
      { root }
    );

    const compiled = await core.execute("jit_compile", { ownership: "detached" }, { root });

    expect(compiled.data).toMatchObject({ ownership: "detached" });
    const status = await createModelToolCore().execute("jit_compile_plan", {}, { root });
    expect(status.data).toMatchObject({ artifactStatus: "detached" });
  });

  it("does not overwrite modified managed files without an explicit policy", async () => {
    const root = projectRoot();
    const core = createModelToolCore();
    const initial = createDeclarationProject();
    await core.execute(
      "jit_model_apply",
      {
        baseRevision: initial.revision,
        operations: [{ op: "create", name: "User", declaration: { kind: "schema", schema: { type: "string" } } }],
      },
      { root }
    );
    await core.execute("jit_compile", {}, { root });
    const generated = join(root, "generated", "index.ts");
    const original = readFileSync(generated, "utf8");
    appendFileSync(generated, "\n// manual edit\n");

    const blocked = await core.execute("jit_compile", {}, { root });
    expect(blocked.data).toMatchObject({ status: "blocked", artifactStatus: "modified" });
    expect(readFileSync(generated, "utf8")).not.toBe(original);

    const replaced = await core.execute("jit_compile", { overwriteModified: true }, { root });
    expect(replaced.data).toMatchObject({ status: "success" });
    expect(readFileSync(generated, "utf8")).toBe(original);
  });
});

describe("agent semantic compile planning", () => {
  const projectRoot = useTemporaryProject();

  it("reports a tightened validation contract at its declaration path", async () => {
    const root = projectRoot();
    const core = createModelToolCore();
    const initial = createDeclarationProject();
    const first = await core.execute(
      "jit_model_apply",
      {
        baseRevision: initial.revision,
        operations: [
          {
            op: "create",
            name: "User",
            declaration: { kind: "schema", schema: { type: "object", fields: { name: { type: "string" } } } },
          },
        ],
      },
      { root }
    );
    await core.execute("jit_compile", {}, { root });
    const revision = (first.data as { readonly revision: string }).revision;
    await core.execute(
      "jit_model_apply",
      {
        baseRevision: revision,
        operations: [
          {
            op: "update",
            name: "User",
            declaration: {
              kind: "schema",
              schema: { type: "object", fields: { name: { type: "string", checks: [{ kind: "min", value: 2 }] } } },
            },
          },
        ],
      },
      { root }
    );

    const plan = await core.execute("jit_compile_plan", {}, { root });

    expect(plan.data).toMatchObject({
      semanticChanges: [{ symbol: "User", change: "validation-tightened", path: ["name"] }],
    });
  });

  it("propagates a changed referenced declaration to its consumers", async () => {
    const root = projectRoot();
    const core = createModelToolCore();
    const initial = createDeclarationProject();
    const applied = await core.execute(
      "jit_model_apply",
      {
        baseRevision: initial.revision,
        operations: REFERENCED_DECLARATIONS,
      },
      { root }
    );
    await core.execute("jit_compile", {}, { root });
    const current = await core.execute(
      "jit_model_apply",
      {
        baseRevision: (applied.data as { readonly revision: string }).revision,
        operations: UPDATED_USER_ID,
      },
      { root }
    );

    const plan = await core.execute("jit_compile_plan", {}, { root });

    expect(current.data).toMatchObject({ status: "success" });
    expect(plan.data).toMatchObject({ affectedDeclarations: ["User", "UserId"] });
  });
});
