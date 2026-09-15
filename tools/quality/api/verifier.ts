import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectFluentOperations } from "../ast/fluent.js";
import type { QualityContext } from "../core/context.js";
import { finding, type QualityFinding } from "../core/finding.js";
import { contractForOperation, type OperationContract } from "./contracts.js";
import { initialState, transition } from "./grammar.js";

export interface ApiInventory {
  readonly operations: readonly ReturnType<typeof collectFluentOperations>[number][];
  readonly contracts: readonly OperationContract[];
}

const inventoryCache = new WeakMap<object, ApiInventory>();

export function buildApiInventory(context: QualityContext): ApiInventory {
  const cached = inventoryCache.get(context);
  if (cached) return cached;
  const operations = collectFluentOperations(context);
  const contracts = operations.flatMap((operation) => {
    const contract = contractForOperation(operation);
    return contract ? [contract] : [];
  });
  const inventory = { operations, contracts };
  inventoryCache.set(context, inventory);
  return inventory;
}

export function apiCoherenceGate(context: QualityContext): QualityFinding[] {
  const inventory = buildApiInventory(context);
  const findings: QualityFinding[] = [];
  for (const operation of inventory.operations) {
    const contract = contractForOperation(operation);
    if (!contract) {
      findings.push(
        finding({
          code: "QG-API-001",
          gate: "api-coherence",
          severity: "error",
          path: operation.path,
          line: operation.line,
          title: "Public fluent operation has no semantic contract",
          message: `Public fluent operation ${operation.name} has no API grammar contract.`,
          evidence: [operation.signature],
          remediation:
            "Add the operation to the appropriate semantic contract family and declare requirements, effects, repeatability, conflicts, terminal behavior and fusion.",
        })
      );
    }
  }
  const seen = new Map<string, OperationContract>();
  for (const contract of inventory.contracts) {
    const previous = seen.get(contract.id);
    if (previous && previous.name !== contract.name)
      findings.push(
        finding({
          code: "QG-API-002",
          gate: "api-coherence",
          severity: "error",
          title: "Duplicate API contract identifier",
          message: `${contract.id} is used by both ${previous.name} and ${contract.name}.`,
          remediation: "Give each semantic operation a stable unique contract id.",
        })
      );
    seen.set(contract.id, contract);
    if (!contract.notes.trim() || !contract.repeat)
      findings.push(
        finding({
          code: "QG-API-003",
          gate: "api-coherence",
          severity: "error",
          title: "API contract is incomplete",
          message: `${contract.name} does not explain its repeat semantics.`,
          remediation: "Complete the operation contract before exposing the fluent operation.",
        })
      );
  }
  findings.push(...verifyCriticalTransitions(inventory.contracts));
  writeInventory(context, inventory);
  return findings;
}

function verifyCriticalTransitions(contracts: readonly OperationContract[]): QualityFinding[] {
  const findings: QualityFinding[] = [];
  for (const contract of contracts) {
    const first = transition(initialState(), contract);
    if (!first.valid && contract.requires.length === 0)
      findings.push(
        finding({
          code: "QG-API-004",
          gate: "api-coherence",
          severity: "error",
          title: "Contract rejects its initial transition",
          message: `${contract.name}: ${first.reason ?? "unknown reason"}`,
          remediation: "Fix the contract requirements or define the initial capability supplied by the factory.",
        })
      );
    const repeated = transition(first.state, contract);
    if (contract.repeat === "forbid" && repeated.valid)
      findings.push(
        finding({
          code: "QG-API-005",
          gate: "api-coherence",
          severity: "error",
          path: contract.name,
          title: "Singleton contract permits repetition",
          message: `${contract.name} is marked forbid but its second transition is valid.`,
          remediation: "Make the repeat rule observable in the grammar and runtime/type-level surface.",
        })
      );
  }
  const email = contracts.find((item) => item.name === "email");
  const validate = contracts.find((item) => item.name === "validate");
  if (email && transition(transition(initialState(), email).state, email).valid)
    findings.push(
      finding({
        code: "QG-API-006",
        gate: "api-coherence",
        severity: "error",
        title: "Email repeat transition is not rejected",
        message: "email -> email is classified as singleton but remains legal in the grammar.",
        remediation: "Reject the repeated stage at the builder boundary or make the contract explicitly accumulate.",
      })
    );
  if (validate) {
    const duplicate = transition(transition(initialState(), validate).state, validate);
    if (duplicate.valid && validate.repeat === "forbid")
      findings.push(
        finding({
          code: "QG-API-007",
          gate: "api-coherence",
          severity: "error",
          title: "Validation repeat transition is not rejected",
          message: "validate -> validate is classified as singleton but remains legal in the grammar.",
          remediation: "Represent validation as a single fused stage or declare an explicit replacement.",
        })
      );
  }
  return findings;
}

function writeInventory(context: QualityContext, inventory: ApiInventory): void {
  mkdirSync(context.reportsDirectory, { recursive: true });
  writeFileSync(
    join(context.reportsDirectory, "api-inventory.json"),
    `${JSON.stringify({ operations: inventory.operations, contracts: inventory.contracts }, null, 2)}\n`
  );
}
