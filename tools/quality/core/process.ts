import { type ExecFileSyncOptions, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface ProcessResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function runLocalBinary(
  root: string,
  binary: string,
  args: readonly string[],
  options: ExecFileSyncOptions = {}
): ProcessResult {
  const local = resolve(root, "node_modules/.bin", binary);
  const command = existsSync(local) ? local : binary;
  try {
    const stdout = execFileSync(command, args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    return { status: 0, stdout: String(stdout), stderr: "" };
  } catch (error) {
    const processError = error as {
      readonly status?: number;
      readonly stdout?: Buffer | string;
      readonly stderr?: Buffer | string;
    };
    return {
      status: processError.status ?? 1,
      stdout: String(processError.stdout ?? ""),
      stderr: String(processError.stderr ?? ""),
    };
  }
}
