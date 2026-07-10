import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { callTool, handleJsonRpc } from "../mcp.js";

interface ToolResponse {
  readonly content: readonly [{ readonly type: "text"; readonly text: string }];
  readonly isError?: boolean;
}

describe("jit MCP server", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "jit-mcp-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("should answer initialize and list tools over JSON-RPC", async () => {
    const messages: unknown[] = [];
    const runtime = {
      cwd: process.cwd(),
      write: (message: unknown) => messages.push(message),
      log: () => undefined,
    };

    await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25" },
      },
      runtime
    );
    await handleJsonRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, runtime);

    expect(messages[0]).toMatchObject({
      id: 1,
      result: {
        protocolVersion: "2025-11-25",
        serverInfo: { name: "jit-mcp" },
      },
    });
    expect(messages[1]).toMatchObject({
      id: 2,
      result: {
        tools: expect.arrayContaining([expect.objectContaining({ name: "jit_aot_generate" })]),
      },
    });
  });

  it("should summarize the current jit project", async () => {
    const result = (await callTool(
      {
        name: "jit_project_context",
        arguments: { root: process.cwd(), includeDocs: false },
      },
      process.cwd()
    )) as unknown as ToolResponse;

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("jit project");
    expect(result.content[0].text).toContain("pnpm test");
  });

  it("should inspect and generate AOT output from explicit declaration exports", async () => {
    mkdirSync(join(projectDir, "src"), { recursive: true });
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

    const inspect = (await callTool(
      {
        name: "jit_aot_inspect",
        arguments: { root: projectDir, files: ["src/user.jit.ts"] },
      },
      process.cwd()
    )) as unknown as ToolResponse;

    expect(inspect.content[0].text).toContain("standalone functions: User_is");

    const generated = (await callTool(
      {
        name: "jit_aot_generate",
        arguments: {
          root: projectDir,
          files: ["src/user.jit.ts"],
          outDir: "generated",
          emitPackageJson: false,
        },
      },
      process.cwd()
    )) as unknown as ToolResponse;

    expect(generated.content[0].text).toContain("generated files:");
    expect(readFileSync(join(projectDir, "generated", "index.mjs"), "utf8")).toContain("const User_is");
  });
});
