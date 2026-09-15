import { execFileSync } from "node:child_process";
import type { ChangedRange } from "../core/context.js";

function git(root: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

export function changedFiles(root: string, mode: "staged" | "changed" | "full"): string[] {
  if (mode === "full") return [];
  const args =
    mode === "staged"
      ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]
      : ["diff", "--name-only", "--diff-filter=ACMR", "HEAD"];
  return git(root, args)
    .split("\n")
    .map((value) => value.trim().replaceAll("\\", "/"))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

export function changedRanges(
  root: string,
  mode: "staged" | "changed" | "full"
): ReadonlyMap<string, readonly ChangedRange[]> {
  if (mode === "full") return new Map();
  const args =
    mode === "staged"
      ? ["diff", "--cached", "--unified=0", "--no-color"]
      : ["diff", "--unified=0", "--no-color", "HEAD"];
  const output = git(root, args);
  const ranges = new Map<string, ChangedRange[]>();
  let currentFile = "";

  for (const line of output.split("\n")) {
    const fileMatch = /^\+\+\+ b\/(.+)$/.exec(line);
    if (fileMatch) {
      currentFile = fileMatch[1] ?? "";
      continue;
    }
    const rangeMatch = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!currentFile || !rangeMatch) continue;
    const start = Number(rangeMatch[1]);
    const count = Number(rangeMatch[2] ?? "1");
    const fileRanges = ranges.get(currentFile) ?? [];
    fileRanges.push({ start, end: Math.max(start, start + count - 1) });
    ranges.set(currentFile, fileRanges);
  }

  return new Map([...ranges.entries()].map(([file, fileRanges]) => [file, mergeRanges(fileRanges)]));
}

function mergeRanges(ranges: readonly ChangedRange[]): ChangedRange[] {
  const ordered = [...ranges].sort((left, right) => left.start - right.start);
  const result: ChangedRange[] = [];
  for (const range of ordered) {
    const previous = result.at(-1);
    if (previous && range.start <= previous.end + 1) previous.end = Math.max(previous.end, range.end);
    else result.push({ ...range });
  }
  return result;
}
