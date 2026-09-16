import { readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".quality",
  "coverage",
  "dist",
  "node_modules",
  ".tshy",
  ".tshy-build",
  ".source",
  "generated",
]);

export function toRepoPath(root: string, file: string): string {
  return relative(root, resolve(root, file)).replaceAll("\\", "/");
}

export function listRepositoryFiles(root: string): string[] {
  const result: string[] = [];

  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) {
        visit(resolve(directory, entry.name));
      } else if (entry.isFile()) {
        result.push(toRepoPath(root, resolve(directory, entry.name)));
      }
    }
  }

  visit(root);
  return result.sort((left, right) => left.localeCompare(right));
}

function isTypeScriptFile(file: string): boolean {
  return /\.(?:cts|mts|ts|tsx)$/.test(file) && !/\.d\.(?:cts|mts|ts)$/.test(file);
}

export function isTestFile(file: string): boolean {
  return /(?:^|\/)(?:__tests__|tests?)(?:\/|$)|\.(?:test|spec)\.[cm]?[tj]sx?$/.test(file);
}

export function isProductionTypeScriptFile(file: string): boolean {
  return isTypeScriptFile(file) && !isTestFile(file) && !file.startsWith("tools/quality/");
}

export function isRelevantSourceFile(file: string): boolean {
  return isTypeScriptFile(file) && !file.startsWith(".quality/");
}
