import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import type { QualityContext } from "../core/context.js";
import { finding, type QualityFinding } from "../core/finding.js";
import { isTestFile } from "../core/paths.js";

export function testArchitectureGate(context: QualityContext): QualityFinding[] {
  const findings: QualityFinding[] = [];
  const configText = readFileSync(resolve(context.root, "vitest.config.ts"), "utf8");
  const setupFiles = [...configText.matchAll(/setupFiles\s*:\s*\[([\s\S]*?)\]/g)].flatMap((match) =>
    [...match[1].matchAll(/resolve\([^,]+,\s*["']([^"']+)["']\)/g)].map((item) => item[1])
  );
  for (const file of setupFiles) {
    const path = file.replaceAll("\\", "/");
    const absolute = resolve(context.root, path);
    let text = "";
    try {
      text = readFileSync(absolute, "utf8");
    } catch {
      continue;
    }
    if (/(?:describe|suite|(?:it|test)(?:\.skip|\.only)?|bench)\s*\(/.test(text))
      findings.push(
        finding({
          code: "QG-TEST-SETUP-001",
          gate: "tests",
          severity: "error",
          path,
          title: "Test declarations are loaded as Vitest setup",
          message: `${path} is listed in setupFiles and contains test declarations.`,
          remediation:
            "Keep setup files limited to environment initialization; move the suite into a project test directory.",
        })
      );
  }
  const seenTitles = new Map<string, string>();
  const seenBodies = new Map<string, string>();
  for (const file of context.files.filter(isTestFile)) {
    const source = context.tsProgram.getSourceFile(resolve(context.root, file));
    if (!source) continue;
    const currentSource = source;
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        const expression = node.expression.getText(source);
        if (
          /^(?:it|test|suite|describe)(?:\.[A-Za-z_$][\w$]*)?$/.test(expression) &&
          node.arguments[0] &&
          ts.isStringLiteral(node.arguments[0])
        ) {
          const title = node.arguments[0].text;
          const key = `${file}:${title}`;
          const previous = seenTitles.get(key);
          if (previous)
            findings.push(
              finding({
                code: "QG-TEST-002",
                gate: "tests",
                severity: "warning",
                path: file,
                line: currentSource.getLineAndCharacterOfPosition(node.getStart(currentSource)).line + 1,
                title: "Duplicate test title in one file",
                message: `${title} is also declared at ${previous}.`,
                remediation: "Give the test a contract-specific title or consolidate a table-driven case.",
              })
            );
          else
            seenTitles.set(
              key,
              `${file}:${currentSource.getLineAndCharacterOfPosition(node.getStart(currentSource)).line + 1}`
            );
          const callback = node.arguments[1];
          if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
            const body = callback.body.getText(currentSource).replace(/\s+/g, " ").trim();
            if (body.length > 0) {
              const previous = seenBodies.get(body);
              if (previous)
                findings.push(
                  finding({
                    code: "QG-TEST-004",
                    gate: "tests",
                    severity: context.changedFiles.includes(file) ? "error" : "warning",
                    path: file,
                    line: currentSource.getLineAndCharacterOfPosition(node.getStart(currentSource)).line + 1,
                    title: "Exact test body is duplicated",
                    message: `The test body is also declared at ${previous}.`,
                    remediation:
                      "Keep one contract-focused test or make the differing behavior explicit in a table-driven case.",
                  })
                );
              else
                seenBodies.set(
                  body,
                  `${file}:${currentSource.getLineAndCharacterOfPosition(node.getStart(currentSource)).line + 1}`
                );
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    const text = readFileSync(source.fileName, "utf8");
    if (text.trim().length === 0)
      findings.push(
        finding({
          code: "QG-TEST-003",
          gate: "tests",
          severity: "error",
          path: file,
          title: "Empty test file",
          message: "The test file contains no source.",
          remediation: "Delete it or add a focused behavioral contract.",
        })
      );
    else if (
      !/\b(?:expect|expectTypeOf)\s*(?:\(|<)|\bassert(?:\.|\s*\()/i.test(text) &&
      context.changedFiles.includes(file)
    )
      findings.push(
        finding({
          code: "QG-TEST-001",
          gate: "tests",
          severity: "error",
          path: file,
          title: "Changed test has no real assertion",
          message: "No expect/assert call was found in the test file.",
          remediation: "Add an assertion that would fail for a meaningful regression.",
        })
      );
  }
  return findings;
}
