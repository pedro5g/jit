import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import qualityConfig from "../../../quality.config.js";
import { changedFiles, changedRanges } from "../git/changed-files.js";
import { isRelevantSourceFile, listRepositoryFiles, toRepoPath } from "./paths.js";

export type QualityMode = "staged" | "changed" | "block" | "full";

export interface ChangedRange {
  start: number;
  end: number;
}

export interface QualityBaseline {
  readonly version: number;
  readonly metrics: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly findings?: readonly string[];
  readonly deadCodeFindings?: readonly string[];
}

interface QualityLayer {
  readonly name: string;
  readonly patterns: readonly string[];
  readonly dependsOn: readonly string[];
}

interface QualityThresholds {
  readonly productionLogicalLoc: number;
  readonly testLogicalLoc: number;
  readonly functionLogicalLoc: number;
  readonly complexity: number;
  readonly nesting: number;
  readonly duplicateLines: number;
  readonly duplicateTokens: number;
  readonly changedCoverageLines: number;
  readonly changedCoverageStatements: number;
  readonly changedCoverageBranches: number;
  readonly criticalMutation: number;
}

export interface QualityConfig {
  readonly sourceRoots: readonly string[];
  readonly publicEntryPoints: readonly string[];
  readonly thresholds: QualityThresholds;
  readonly layers: readonly QualityLayer[];
  readonly compositionRoots: readonly string[];
  readonly ignoredPaths: readonly string[];
}

export interface QualityContext {
  readonly root: string;
  readonly mode: QualityMode;
  readonly files: readonly string[];
  readonly changedFiles: readonly string[];
  readonly changedRanges: ReadonlyMap<string, readonly ChangedRange[]>;
  readonly tsProgram: ts.Program;
  readonly baseline: QualityBaseline | undefined;
  readonly config: QualityConfig;
  readonly reportsDirectory: string;
}

export function createQualityContext(
  root: string,
  mode: QualityMode,
  requestedFiles: readonly string[] = []
): QualityContext {
  const repositoryFiles = listRepositoryFiles(root).filter(isRelevantSourceFile);
  const changed = mode === "full" ? [] : changedFiles(root, mode === "block" ? "changed" : mode);
  const selected =
    mode === "full" ? repositoryFiles : resolveSelectedFiles(root, requestedFiles, changed, repositoryFiles);
  const configPath = resolve(root, "tsconfig.json");
  const parsed = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
      },
    }
  );
  if (!parsed) throw new Error(`Unable to read ${toRepoPath(root, configPath)}`);
  const tsProgram = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const baselinePath = resolve(root, ".quality/baseline.json");
  const baseline = existsSync(baselinePath)
    ? (JSON.parse(readFileSync(baselinePath, "utf8")) as QualityBaseline)
    : undefined;

  return {
    root,
    mode,
    files: selected,
    changedFiles: changed,
    changedRanges: changedRanges(root, mode === "block" ? "changed" : mode),
    tsProgram,
    baseline,
    config: qualityConfig,
    reportsDirectory: resolve(root, ".quality/reports"),
  };
}

function resolveSelectedFiles(
  root: string,
  requestedFiles: readonly string[],
  changed: readonly string[],
  files: readonly string[]
): string[] {
  const candidates = requestedFiles.length > 0 ? requestedFiles : changed;
  if (candidates.length === 0) return [...files];
  const normalized = candidates.map((file) => toRepoPath(root, file));
  return files.filter((file) => normalized.some((candidate) => file === candidate || file.startsWith(`${candidate}/`)));
}
