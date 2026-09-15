import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ApiChallenge, buildApiChallenges } from "../api/challenges.js";
import { buildApiInventory } from "../api/verifier.js";
import type { QualityContext } from "../core/context.js";
import { finding, type QualityFinding } from "../core/finding.js";

export function apiChallengeGate(context: QualityContext): QualityFinding[] {
  const inventory = buildApiInventory(context);
  const challenges = buildApiChallenges(inventory.contracts);
  writeChallengeReport(context, challenges);
  return challenges.flatMap(challengeFinding);
}

function challengeFinding(challenge: ApiChallenge): QualityFinding[] {
  if (challenge.status === "verified") return [];
  const blocked = challenge.status === "blocked";
  return [
    finding({
      code: blocked ? "QG-API-CHALLENGE-002" : "QG-API-CHALLENGE-001",
      gate: "api-challenge",
      severity: blocked ? "error" : "warning",
      title: blocked ? "API semantic challenge failed" : "API semantic decision is not explicit",
      message: `${challenge.question} Expected ${challenge.expected}; grammar observed ${challenge.actual}. Status: ${challenge.status}.`,
      evidence: [`challenge: ${challenge.id}`, `sequence: ${challenge.sequence.join(" -> ")}`, ...challenge.evidence],
      remediation: challenge.remediation,
      metadata: {
        challengeId: challenge.id,
        kind: challenge.kind,
        expected: challenge.expected,
        actual: challenge.actual,
        status: challenge.status,
      },
    }),
  ];
}

function writeChallengeReport(context: QualityContext, challenges: readonly ApiChallenge[]): void {
  mkdirSync(context.reportsDirectory, { recursive: true });
  writeFileSync(join(context.reportsDirectory, "api-challenges.json"), `${JSON.stringify({ challenges }, null, 2)}\n`);
}
