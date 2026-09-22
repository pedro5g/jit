import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { QualityContext } from "../core/context.js";
import { finding, type QualityFinding } from "../core/finding.js";
import { runLocalBinary } from "../core/process.js";

interface ArtifactPaths {
  readonly generator: string;
  readonly contracts: string;
  readonly manifest: string;
  readonly status: string;
  readonly validation: string;
  readonly graph: string;
  readonly portableErrors: string;
  readonly names: string;
}

/** Checks the source-independent artifact contracts and their focused fixtures. */
export function artifactGate(context: QualityContext): QualityFinding[] {
  const paths = artifactPaths(context.root);
  if (!existsSync(paths.generator) || !existsSync(paths.contracts)) return [missingFixtureFinding()];

  const source = readArtifactSources(paths);
  return [
    ...checkGeneratorSource(source.generator),
    ...checkPortableNaming(source.portableErrors, source.names),
    ...checkManifestSource(source.manifest, source.status, source.validation),
    ...checkGraphSource(source.graph),
    ...checkFixtureSource(source.fixture, paths.contracts),
    ...runArtifactTests(context),
  ];
}

function artifactPaths(root: string): ArtifactPaths {
  const path = (value: string): string => resolve(root, value);
  return {
    generator: path("packages/jit/src/aot/generate.ts"),
    contracts: path("packages/jit/src/aot/__tests__/artifact-contracts.test.ts"),
    manifest: path("packages/jit/src/aot/artifact-manifest.ts"),
    status: path("packages/jit/src/aot/artifact-status.ts"),
    validation: path("packages/jit/src/aot/artifact-manifest-validation.ts"),
    graph: path("packages/jit/src/aot/artifact-program.ts"),
    portableErrors: path("packages/jit/src/errors/portable.ts"),
    names: path("packages/jit/src/aot/semantic-name.ts"),
  };
}

function readArtifactSources(paths: ArtifactPaths): Record<string, string> {
  return {
    generator: readFileSync(paths.generator, "utf8"),
    manifest: readFileSync(paths.manifest, "utf8"),
    status: readFileSync(paths.status, "utf8"),
    validation: readFileSync(paths.validation, "utf8"),
    graph: readFileSync(paths.graph, "utf8"),
    portableErrors: readFileSync(paths.portableErrors, "utf8"),
    names: readFileSync(paths.names, "utf8"),
    fixture: readFileSync(paths.contracts, "utf8"),
  };
}

function missingFixtureFinding(): QualityFinding {
  return finding({
    code: "QG-ARTIFACT-001",
    gate: "artifact",
    severity: "error",
    title: "Artifact contract fixture is missing",
    message: "The artifact generator and its standalone contract fixture must remain present.",
    remediation: "Restore ArtifactProgram, manifest and standalone parity coverage before changing the emitter.",
  });
}

function checkGeneratorSource(source: string): QualityFinding[] {
  const findings: QualityFinding[] = [];
  if (source.includes('from "@jit-compiler/')) {
    findings.push(
      finding({
        code: "QG-ARTIFACT-001",
        gate: "artifact",
        severity: "error",
        path: "packages/jit/src/aot/generate.ts",
        title: "AOT generator imports a package runtime",
        message: "Generated modules must be assembled without a dependency on @jit-compiler/*.",
        remediation: "Keep runtime bindings at the compiler boundary and inline or specialize generated helpers.",
      })
    );
  }
  if (source.includes("@ts-nocheck")) {
    findings.push(
      finding({
        code: "QG-ARTIFACT-004",
        gate: "artifact",
        severity: "error",
        path: "packages/jit/src/aot/generate.ts",
        title: "Typed AOT output relies on ts-nocheck",
        message: "Standalone TypeScript output must typecheck without disabling the compiler.",
        remediation: "Emit typed helper boundaries and validate the generated module with the TypeScript checker.",
      })
    );
  }
  return findings;
}

function checkPortableNaming(portableErrors: string, names: string): QualityFinding[] {
  const findings: QualityFinding[] = [];
  if (!portableErrors.includes("class ValidationError") || !portableErrors.includes("PortableValidationIssue")) {
    findings.push(
      finding({
        code: "QG-ARTIFACT-002",
        gate: "artifact",
        severity: "error",
        path: "packages/jit/src/errors/portable.ts",
        title: "Portable error ABI is missing",
        message: "Standalone artifacts need structural errors independent of JIT nominal classes.",
        remediation: "Keep ValidationError and the portable issue shape available to AOT emission.",
      })
    );
  }
  if (!names.includes("SemanticNameAllocator") || !names.includes('"semantic"')) {
    findings.push(
      finding({
        code: "QG-ARTIFACT-003",
        gate: "artifact",
        severity: "error",
        path: "packages/jit/src/aot/semantic-name.ts",
        title: "Deterministic semantic naming is missing",
        message: "The AOT emitter must select names through the dedicated compact/semantic allocator.",
        remediation: "Route generated temporary names through SemanticNameAllocator and cover both profiles.",
      })
    );
  }
  return findings;
}

function checkManifestSource(manifest: string, status: string, validation: string): QualityFinding[] {
  const findings: QualityFinding[] = [];
  if (!status.includes("inspectArtifactStatus") || !status.includes("sha256(readFileSync")) {
    findings.push(
      finding({
        code: "QG-MANIFEST-003",
        gate: "artifact",
        severity: "error",
        path: "packages/jit/src/aot/artifact-manifest.ts",
        title: "Manifest file integrity check is missing",
        message: "Managed status must hash every declared artifact file before trusting semantic metadata.",
        remediation: "Keep the manifest status check bound to file hashes and receipt digests.",
      })
    );
  }
  if (manifest.includes("localeCompare") || !manifest.includes("manifestDigest")) {
    findings.push(
      finding({
        code: "QG-MANIFEST-004",
        gate: "artifact",
        severity: "error",
        path: "packages/jit/src/aot/artifact-manifest.ts",
        title: "Manifest determinism contract is unsafe",
        message: "Manifest ordering and digest binding must be locale-independent and explicit.",
        remediation: "Use deterministic code-point ordering and bind the manifest digest to canonical contents.",
      })
    );
  }
  if (!validation.includes("isArtifactManifest") || !status.includes("receipt does not match")) {
    findings.push(
      finding({
        code: "QG-MANIFEST-001",
        gate: "artifact",
        severity: "error",
        path: "packages/jit/src/aot/artifact-manifest.ts",
        title: "Manifest completeness validation is missing",
        message: "Generated exports and receipt fields must be validated before agent lookup.",
        remediation: "Keep structural manifest validation and receipt cross-checks in the status path.",
      })
    );
  }
  return findings;
}

function checkGraphSource(source: string): QualityFinding[] {
  return source.includes("topologicalModuleOrder") && source.includes("cycle")
    ? []
    : [
        finding({
          code: "QG-MANIFEST-005",
          gate: "artifact",
          severity: "error",
          path: "packages/jit/src/aot/artifact-program.ts",
          title: "Module graph dependency validation is missing",
          message: "Every manifest dependency must be validated before source emission.",
          remediation: "Reject missing modules and cycles in ArtifactProgram construction.",
        }),
      ];
}

function checkFixtureSource(source: string, path: string): QualityFinding[] {
  const findings: QualityFinding[] = [];
  if (!source.includes("symbolToFile") || !source.includes("symbolConsumers")) {
    findings.push(
      finding({
        code: "QG-MANIFEST-002",
        gate: "artifact",
        severity: "error",
        path,
        title: "Manifest symbol lookup coverage is missing",
        message: "The agent index must resolve symbols to files and reverse consumers without source parsing.",
        remediation: "Add forward and reverse manifest index assertions before changing the protocol.",
      })
    );
  }
  if (!source.includes("portableErrors") || !source.includes("inspectArtifactStatus")) {
    findings.push(
      finding({
        code: "QG-ARTIFACT-005",
        gate: "artifact",
        severity: "error",
        path,
        title: "Portable ABI or integrity coverage is missing",
        message: "The focused artifact fixture must cover portable errors and hash-bound status.",
        remediation: "Add runtime/AOT checks before extending the artifact contract.",
      })
    );
  }
  return findings;
}

function runArtifactTests(context: QualityContext): QualityFinding[] {
  const result = runLocalBinary(context.root, "vitest", [
    "run",
    "packages/jit/src/aot/__tests__/artifact-contracts.test.ts",
    "packages/jit/src/aot/__tests__/discover.test.ts",
    "--reporter=dot",
  ]);
  return result.status === 0
    ? []
    : [
        finding({
          code: "QG-ARTIFACT-005",
          gate: "artifact",
          severity: "error",
          title: "Artifact contract tests failed",
          message: `${result.stdout}\n${result.stderr}`.trim().slice(-5000),
          remediation:
            "Fix ArtifactProgram, manifest integrity, standalone source or runtime/AOT parity before continuing.",
        }),
      ];
}
