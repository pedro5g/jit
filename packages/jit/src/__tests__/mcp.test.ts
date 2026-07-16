import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { callTool, handleJsonRpc, processJsonRpcLine } from "../mcp.js";

interface ToolResponse {
  readonly content: readonly [{ readonly type: "text"; readonly text: string }];
  readonly structuredContent: Readonly<Record<string, unknown>>;
  readonly isError?: boolean;
}

describe("jit MCP server", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "jit-mcp-"));
    mkdirSync(join(projectDir, "docs"), { recursive: true });
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "fixture", scripts: { test: "vitest run", build: "tsc" } }, null, 2)
    );
    writeFileSync(join(projectDir, "README.md"), "# Fixture\n\nCompile only explicit operations.\n");
    writeFileSync(
      join(projectDir, "docs", "architecture.md"),
      "# Architecture\n\nAOT output has zero runtime imports.\n"
    );
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  describe("protocol", () => {
    it("negotiates the current version and advertises every implemented server capability", async () => {
      const messages = await rpc(projectDir, [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
        },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ]);

      expect(messages[0]).toMatchObject({
        id: 1,
        result: {
          protocolVersion: "2025-11-25",
          capabilities: { tools: {}, resources: {}, prompts: {}, completions: {}, logging: {} },
          serverInfo: { name: "jit-mcp", version: "1.0.1" },
        },
      });
      const listed = messages[1] as { readonly id: number; readonly result: { readonly tools: readonly unknown[] } };
      expect(listed.id).toBe(2);
      expect(listed.result.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "jit_aot_generate",
            outputSchema: { type: "object", additionalProperties: true },
            annotations: expect.objectContaining({ readOnlyHint: false, idempotentHint: true }),
          }),
          expect.objectContaining({
            name: "jit_aot_preview",
            annotations: expect.objectContaining({ readOnlyHint: true }),
          }),
        ])
      );
    });

    it("answers parse, invalid-request, unknown-method, and invalid-cursor errors", async () => {
      const messages: unknown[] = [];
      const runtime = testRuntime(projectDir, messages);

      await processJsonRpcLine("{", runtime);
      await processJsonRpcLine('{"jsonrpc":"2.0","id":4}', runtime);
      await processJsonRpcLine('{"jsonrpc":"2.0","id":5,"method":"missing"}', runtime);
      await processJsonRpcLine('{"jsonrpc":"2.0","id":6,"method":"tools/list","params":{"cursor":"stale"}}', runtime);

      expect(messages).toMatchObject([
        { id: null, error: { code: -32700 } },
        { id: 4, error: { code: -32600 } },
        { id: 5, error: { code: -32601 } },
        { id: 6, error: { code: -32602 } },
      ]);
    });

    it("responds with the newest supported protocol when the requested version is unsupported", async () => {
      const messages = await rpc(projectDir, [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2099-01-01" } },
      ]);

      expect(messages[0]).toMatchObject({ result: { protocolVersion: "2025-11-25" } });
    });
  });

  describe("project context and documentation", () => {
    it("returns text plus structured project context and documentation matches", async () => {
      const context = asTool(
        await callTool({ name: "jit_project_context", arguments: { includeDocs: false } }, projectDir)
      );
      const search = asTool(
        await callTool({ name: "jit_docs_search", arguments: { query: "zero runtime" } }, projectDir)
      );

      expect(context.isError).toBeUndefined();
      expect(context.content[0].text).toContain("jit project: fixture");
      expect(context.structuredContent).toMatchObject({ name: "fixture", commands: ["pnpm test", "pnpm build"] });
      expect(search.content[0].text).toContain("docs/architecture.md:3");
      expect(search.structuredContent.matches).toHaveLength(1);
    });

    it("lists and reads fixed resources, templates, docs, and completion values", async () => {
      const messages = await rpc(projectDir, [
        { jsonrpc: "2.0", id: 1, method: "resources/list" },
        { jsonrpc: "2.0", id: 2, method: "resources/templates/list" },
        { jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: "jit://project/architecture" } },
        {
          jsonrpc: "2.0",
          id: 4,
          method: "resources/read",
          params: { uri: "jit://docs/architecture.md" },
        },
        {
          jsonrpc: "2.0",
          id: 5,
          method: "completion/complete",
          params: {
            ref: { type: "ref/prompt", name: "jit_schema_design" },
            argument: { name: "mode", value: "a" },
          },
        },
      ]);

      expect(messages[0]).toMatchObject({
        result: { resources: expect.arrayContaining([expect.objectContaining({ uri: "jit://project/architecture" })]) },
      });
      expect(messages[1]).toMatchObject({
        result: {
          resourceTemplates: expect.arrayContaining([expect.objectContaining({ uriTemplate: "jit://docs/{path}" })]),
        },
      });
      expect(messages[2]).toMatchObject({ result: { contents: [{ mimeType: "text/markdown" }] } });
      expect(messages[3]).toMatchObject({
        result: { contents: [{ text: expect.stringContaining("zero runtime imports") }] },
      });
      expect(messages[4]).toMatchObject({ result: { completion: { values: ["aot"], hasMore: false } } });
    });

    it("returns a resource error when a template tries to leave its allowed directory", async () => {
      const messages = await rpc(projectDir, [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "resources/read",
          params: { uri: "jit://docs/%2E%2E%2Fpackage.json" },
        },
      ]);

      expect(messages[0]).toMatchObject({
        id: 1,
        error: { code: -32002, message: expect.stringContaining("must stay") },
      });
    });
  });

  describe("prompts", () => {
    it("lists prompts and renders schema, AOT, and performance workflows", async () => {
      const messages = await rpc(projectDir, [
        { jsonrpc: "2.0", id: 1, method: "prompts/list" },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "prompts/get",
          params: { name: "jit_schema_design", arguments: { goal: "an API user", mode: "aot" } },
        },
        { jsonrpc: "2.0", id: 3, method: "prompts/get", params: { name: "jit_aot_workflow" } },
        {
          jsonrpc: "2.0",
          id: 4,
          method: "prompts/get",
          params: { name: "jit_performance_review", arguments: { operation: "validate", dataShape: "100k users" } },
        },
      ]);

      expect(messages[0]).toMatchObject({
        result: { prompts: expect.arrayContaining([expect.objectContaining({ name: "jit_aot_workflow" })]) },
      });
      expect(messages[1]).toMatchObject({
        result: { messages: [{ content: { text: expect.stringContaining("an API user") } }] },
      });
      expect(messages[2]).toMatchObject({
        result: { messages: [{ content: { text: expect.stringContaining("preview generated") } }] },
      });
      expect(messages[3]).toMatchObject({
        result: { messages: [{ content: { text: expect.stringContaining("100k users") } }] },
      });
    });
  });

  describe("AOT tools", () => {
    beforeEach(() => writeAotFixture(projectDir));

    it("inspects explicit exports and validates the project with doctor", async () => {
      const inspect = asTool(await callTool({ name: "jit_aot_inspect", arguments: {} }, projectDir));
      const doctor = asTool(await callTool({ name: "jit_project_doctor", arguments: {} }, projectDir));

      expect(inspect.content[0].text).toContain("standalone functions: User_is");
      expect(inspect.structuredContent).toMatchObject({
        configFile: "jit.config.mjs",
        standalone: [{ name: "User_is", operations: ["is"], source: "src/user.jit.ts" }],
      });
      expect(doctor.structuredContent).toMatchObject({ ok: true, grouped: 0, standalone: 1 });
    });

    it("previews generated source without writing to the configured output", async () => {
      const preview = asTool(await callTool({ name: "jit_aot_preview", arguments: { stage: "source" } }, projectDir));
      const plan = asTool(
        await callTool({ name: "jit_aot_preview", arguments: { stage: "plan", target: "User_is" } }, projectDir)
      );

      expect(preview.isError).toBeUndefined();
      expect(preview.content[0].text).toContain("const User_is");
      expect(plan.isError).toBeUndefined();
      expect(plan.structuredContent).toMatchObject({ selectedFile: "plans/index.json" });
      expect(plan.content[0].text).toContain('"name": "User_is"');
      expect(() => readFileSync(join(projectDir, "generated", "index.js"), "utf8")).toThrow();
    });

    it("requires explicit write confirmation and then generates typed package artifacts", async () => {
      const rejected = asTool(await callTool({ name: "jit_aot_generate", arguments: {} }, projectDir));
      const generated = asTool(await callTool({ name: "jit_aot_generate", arguments: { write: true } }, projectDir));

      expect(rejected.isError).toBe(true);
      expect(rejected.content[0].text).toContain('requires "write": true');
      expect(generated.isError).toBeUndefined();
      expect(generated.structuredContent).toMatchObject({
        outDir: "generated",
        files: expect.arrayContaining(["generated/index.js", "generated/index.d.ts", "generated/manifest.json"]),
      });
      expect(readFileSync(join(projectDir, "generated", "index.js"), "utf8")).toContain("const User_is");
      expect(readFileSync(join(projectDir, "generated", "index.d.ts"), "utf8")).toContain("User_is");
    });

    it("rejects roots, declaration files, and outputs outside the MCP workspace", async () => {
      const rootEscape = asTool(await callTool({ name: "jit_project_context", arguments: { root: ".." } }, projectDir));
      const fileEscape = asTool(
        await callTool({ name: "jit_aot_inspect", arguments: { files: ["../outside.jit.ts"] } }, projectDir)
      );
      const outputEscape = asTool(
        await callTool({ name: "jit_aot_generate", arguments: { write: true, outDir: "../generated" } }, projectDir)
      );

      expect(rootEscape).toMatchObject({ isError: true });
      expect(fileEscape).toMatchObject({ isError: true });
      expect(outputEscape).toMatchObject({ isError: true });
      expect(rootEscape.content[0].text).toContain("must stay inside");
    });

    it("rejects a not-yet-created output below a symlink that leaves the workspace", async () => {
      const outside = mkdtempSync(join(tmpdir(), "jit-mcp-outside-"));

      try {
        symlinkSync(outside, join(projectDir, "outside-link"), "dir");
        const result = asTool(
          await callTool(
            { name: "jit_aot_generate", arguments: { write: true, outDir: "outside-link/not-created" } },
            projectDir
          )
        );

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("must stay inside");
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });
});

function writeAotFixture(projectDir: string): void {
  mkdirSync(join(projectDir, "src"), { recursive: true });
  writeFileSync(
    join(projectDir, "jit.config.mjs"),
    [
      "export default {",
      '  entries: ["src/**/*.jit.ts"],',
      '  output: { directory: "generated", clean: true },',
      '  types: { package: "@fixture/compiler" },',
      "  emit: { manifest: true, plans: true },",
      "};",
      "",
    ].join("\n")
  );
  writeFileSync(
    join(projectDir, "src", "user.jit.ts"),
    [
      `import { JIT } from ${JSON.stringify(pathToFileURL(join(process.cwd(), "packages", "jit", "src", "index.ts")).href)};`,
      "const User = JIT.object({ id: JIT.number() });",
      "const selected = JIT.validator(User).get('is');",
      "export const User_is = selected.is;",
      "",
    ].join("\n")
  );
}

function asTool(value: unknown): ToolResponse {
  return value as ToolResponse;
}

function testRuntime(cwd: string, messages: unknown[]) {
  return {
    cwd,
    write: (message: unknown) => messages.push(message),
    log: () => undefined,
  };
}

async function rpc(cwd: string, requests: readonly Parameters<typeof handleJsonRpc>[0][]): Promise<unknown[]> {
  const messages: unknown[] = [];
  const runtime = testRuntime(cwd, messages);
  for (const request of requests) await handleJsonRpc(request, runtime);
  return messages;
}
