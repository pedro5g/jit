import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { QualityContext } from "../core/context.js";
import { finding, type QualityFinding } from "../core/finding.js";
import { runLocalBinary } from "../core/process.js";

interface PackageManifest {
  readonly exports?: unknown;
  readonly bin?: Readonly<Record<string, string>>;
}

/** Checks the built package and the real publish file list, not source paths. */
export function packageGate(context: QualityContext): QualityFinding[] {
  if (context.mode !== "full") return [];
  const packageDir = resolve(context.root, "packages/jit");
  const packagePath = resolve(packageDir, "package.json");
  if (!existsSync(resolve(packageDir, "dist/index.js"))) return [missingDistFinding()];

  const manifest = JSON.parse(readFileSync(packagePath, "utf8")) as PackageManifest;
  return [...checkExportTargets(packageDir, manifest), ...checkTarball(context, packageDir)];
}

function missingDistFinding(): QualityFinding {
  return finding({
    code: "QG-PACKAGE-001",
    gate: "package",
    severity: "error",
    path: "packages/jit/dist/index.js",
    title: "Package dist output is missing",
    message: "The published package must be built under packages/jit/dist.",
    remediation: "Run pnpm --filter @jit-compiler/jit build.",
  });
}

function checkExportTargets(packageDir: string, manifest: PackageManifest): QualityFinding[] {
  const findings: QualityFinding[] = [];
  for (const target of [...collectStringValues(manifest.exports), ...Object.values(manifest.bin ?? {})]) {
    if (target.startsWith("./src/") || target === "src") continue;
    if (target.startsWith("./") && !existsSync(resolve(packageDir, target.slice(2))))
      findings.push(missingTargetFinding(target));
  }
  return findings;
}

function missingTargetFinding(target: string): QualityFinding {
  return finding({
    code: "QG-PACKAGE-002",
    gate: "package",
    severity: "error",
    path: "packages/jit/package.json",
    title: "Package export target is missing",
    message: `${target} does not resolve to a built file.`,
    remediation: "Build dist and keep package exports synchronized with tsconfig.build.json.",
  });
}

function checkTarball(context: QualityContext, packageDir: string): QualityFinding[] {
  const packed = runLocalBinary(context.root, "pnpm", ["pack", "--dry-run", "--json"], { cwd: packageDir });
  if (packed.status !== 0) return [tarballFailure(packed.stdout, packed.stderr)];
  try {
    return checkTarballFiles(JSON.parse(packed.stdout) as { readonly files?: readonly { readonly path: string }[] });
  } catch (error) {
    return [
      finding({
        code: "QG-PACKAGE-005",
        gate: "package",
        severity: "error",
        path: "packages/jit/package.json",
        title: "Package tarball output is not JSON",
        message: error instanceof Error ? error.message : String(error),
        remediation: "Use the pnpm pack JSON output as the package inspection contract.",
      }),
    ];
  }
}

function tarballFailure(stdout: string, stderr: string): QualityFinding {
  return finding({
    code: "QG-PACKAGE-005",
    gate: "package",
    severity: "error",
    path: "packages/jit/package.json",
    title: "Package tarball inspection failed",
    message: `${stdout}\n${stderr}`.trim().slice(-4000),
    remediation: "Fix the package manifest and rerun pnpm quality:package.",
  });
}

function checkTarballFiles(result: { readonly files?: readonly { readonly path: string }[] }): QualityFinding[] {
  const files = result.files ?? [];
  const findings: QualityFinding[] = [];
  const forbidden = files.filter(({ path }) => path.startsWith("src/") || path.includes("/__tests__/"));
  if (forbidden.length > 0) {
    findings.push(
      finding({
        code: "QG-PACKAGE-003",
        gate: "package",
        severity: "error",
        path: "packages/jit/package.json",
        title: "Package tarball contains source or tests",
        message: forbidden.map(({ path }) => path).join(", "),
        remediation: "Publish only dist, package metadata, README and LICENSE.",
      })
    );
  }
  if (!files.some(({ path }) => path === "dist/index.js") || !files.some(({ path }) => path === "dist/index.d.cts")) {
    findings.push(
      finding({
        code: "QG-PACKAGE-004",
        gate: "package",
        severity: "error",
        path: "packages/jit/package.json",
        title: "Tarball is missing the runtime or declaration entrypoint",
        message: "The packed package must contain dist/index.js and dist/index.d.cts.",
        remediation: "Keep files, exports and the dist build output aligned.",
      })
    );
  }
  return findings;
}

function collectStringValues(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStringValues);
  if (typeof value !== "object" || value === null) return [];
  return Object.values(value).flatMap(collectStringValues);
}
