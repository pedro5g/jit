#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);
const target = `${process.platform}-${process.arch}`;
const packages = {
  "darwin-arm64": "@jit-compiler/cli-darwin-arm64",
  "darwin-x64": "@jit-compiler/cli-darwin-x64",
  "linux-arm64": "@jit-compiler/cli-linux-arm64",
  "linux-x64": "@jit-compiler/cli-linux-x64",
  "win32-x64": "@jit-compiler/cli-win32-x64",
};
const packageName = packages[target];

if (!packageName) {
  fail(`unsupported platform ${target}`);
}

const executable = process.platform === "win32" ? "jit-artifact.exe" : "jit-artifact";
let binary;
try {
  binary = require.resolve(`${packageName}/bin/${executable}`);
} catch {
  const workspaceFallback = resolve(import.meta.dirname, "../../../target/release", executable);
  const debugFallback = resolve(import.meta.dirname, "../../../target/debug", executable);
  binary = existsSync(workspaceFallback)
    ? workspaceFallback
    : existsSync(debugFallback)
      ? debugFallback
      : undefined;
}

if (!binary) {
  fail(
    `native package ${packageName} is unavailable; reinstall @jit-compiler/cli with optional dependencies enabled`
  );
}

const result = spawnSync(binary, process.argv.slice(2), { stdio: "inherit" });
if (result.error) fail(result.error.message);
process.exitCode = result.status ?? 1;

function fail(message) {
  console.error(`jit-artifact: ${message}`);
  process.exit(1);
}
