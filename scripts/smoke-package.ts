import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface PackedFile {
  path: string;
}

interface PackResult {
  filename: string;
  entryCount: number;
  unpackedSize: number;
  files: PackedFile[];
}

const root = new URL("..", import.meta.url).pathname;
const packageDir = join(root, "packages/jit");
const tempDir = mkdtempSync(join(tmpdir(), "jit-package-"));

function run(command: string, args: string[], cwd: string, input?: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    ...(input === undefined ? {} : { input }),
    env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
  });
}

try {
  const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", tempDir], packageDir)) as PackResult[];
  const result = packed[0];
  if (!result) throw new Error("npm pack returned no package");

  const forbidden = result.files.filter(({ path }) => {
    if (path.startsWith("src/") || path.includes("/__tests__/")) return true;
    return /\.tsx?$/.test(path) && !/\.d\.(?:m|c)?ts$/.test(path);
  });
  if (forbidden.length > 0) {
    throw new Error(`npm package contains source/test files: ${forbidden.map(({ path }) => path).join(", ")}`);
  }
  if (result.unpackedSize > 2_500_000) {
    throw new Error(`npm package is unexpectedly large: ${result.unpackedSize} unpacked bytes`);
  }

  const consumerDir = join(tempDir, "consumer");
  mkdirSync(consumerDir);
  writeFileSync(join(consumerDir, "package.json"), '{"private":true,"type":"module"}\n');
  run("npm", ["install", "--ignore-scripts", join(tempDir, result.filename)], consumerDir);

  writeFileSync(
    join(consumerDir, "esm.mjs"),
    'import { JIT } from "@jit-compiler/jit/runtime";\nconst schema = JIT.object({ id: JIT.int() });\nif (!JIT.validator(schema).is({ id: 1 })) process.exit(1);\n'
  );
  writeFileSync(
    join(consumerDir, "cjs.cjs"),
    'const { JIT } = require("@jit-compiler/jit/runtime");\nconst schema = JIT.object({ id: JIT.int() });\nif (!JIT.validator(schema).is({ id: 1 })) process.exit(1);\n'
  );
  run(process.execPath, ["esm.mjs"], consumerDir);
  run(process.execPath, ["cjs.cjs"], consumerDir);

  const cli = run(
    process.execPath,
    [join(consumerDir, "node_modules/@jit-compiler/jit/cli.js"), "--help"],
    consumerDir
  );
  if (!cli.includes("jit generate")) throw new Error("packed CLI help did not load correctly");
  const cliShim = run(join(consumerDir, "node_modules/.bin/jit"), ["--help"], consumerDir);
  if (!cliShim.includes("jit generate")) throw new Error("packed jit bin shim did not load correctly");

  const mcpOutput = run(
    process.execPath,
    [join(consumerDir, "node_modules/@jit-compiler/jit/mcp.js")],
    consumerDir,
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "smoke", version: "1" } },
    })}\n`
  );
  const mcpResponse = JSON.parse(mcpOutput.trim()) as {
    result?: {
      serverInfo?: { name?: string };
      capabilities?: { tools?: unknown; resources?: unknown; prompts?: unknown };
    };
  };
  if (
    mcpResponse.result?.serverInfo?.name !== "jit-mcp" ||
    mcpResponse.result.capabilities?.tools === undefined ||
    mcpResponse.result.capabilities.resources === undefined ||
    mcpResponse.result.capabilities.prompts === undefined
  ) {
    throw new Error("packed MCP stdio server did not negotiate its complete capability set");
  }
  const mcpShimOutput = run(
    join(consumerDir, "node_modules/.bin/jit-mcp"),
    [],
    consumerDir,
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "smoke", version: "1" } },
    })}\n`
  );
  const mcpShimResponse = JSON.parse(mcpShimOutput.trim()) as { result?: { serverInfo?: { name?: string } } };
  if (mcpShimResponse.result?.serverInfo?.name !== "jit-mcp") {
    throw new Error("packed jit-mcp bin shim did not load correctly");
  }

  const manifest = JSON.parse(
    readFileSync(join(consumerDir, "node_modules/@jit-compiler/jit/package.json"), "utf8")
  ) as {
    name?: string;
    version?: string;
    bin?: { jit?: string; "jit-mcp"?: string };
  };
  if (manifest.name !== "@jit-compiler/jit") {
    throw new Error(`packed npm package name is invalid: ${JSON.stringify(manifest.name)}`);
  }
  if (manifest.bin?.jit !== "cli.js" || manifest.bin["jit-mcp"] !== "mcp.js") {
    throw new Error(`packed bin map is invalid: ${JSON.stringify(manifest.bin)}`);
  }
  console.log(
    `Packed ${manifest.name}@${manifest.version}: ${result.entryCount} files, ${result.unpackedSize} unpacked bytes; ESM, CJS, CLI, and MCP smoke tests passed.`
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
