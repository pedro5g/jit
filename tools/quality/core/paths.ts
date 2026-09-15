import { readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

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

export function absolutePath(root: string, file: string): string {
  return resolve(root, file);
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

export function isTypeScriptFile(file: string): boolean {
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

export function isPathInside(root: string, file: string): boolean {
  const rootPath = resolve(root);
  const filePath = resolve(root, file);
  return filePath === rootPath || filePath.startsWith(`${rootPath}/`);
}

export function packageNameForPath(file: string): string {
  const parts = file.split("/");
  if (parts[0] === "packages" || parts[0] === "apps") return parts.slice(0, 2).join("/");
  return parts[0] ?? ".";
}

export function nearestDirectory(file: string): string {
  return dirname(file).replaceAll("\\", "/");
}

export function safeStat(root: string, file: string): ReturnType<typeof statSync> | undefined {
  try {
    return statSync(resolve(root, file));
  } catch {
    return undefined;
  }
}
