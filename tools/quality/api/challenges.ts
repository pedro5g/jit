import type { OperationContract } from "./contracts.js";
import { type GrammarState, initialState, transition } from "./grammar.js";

type ApiChallengeKind = "repeat" | "combination" | "alias" | "exclusive" | "terminal" | "prerequisite" | "fusion";

type ApiChallengeExpectation = "valid" | "invalid" | "decision-required";
type ApiChallengeActual = "valid" | "invalid";
type ApiChallengeStatus = "verified" | "needs-design" | "blocked";

interface ApiChallengeStep {
  readonly id: string;
  readonly name: string;
  readonly family: string;
  readonly semanticKey: string;
}

export interface ApiChallenge {
  readonly id: string;
  readonly kind: ApiChallengeKind;
  readonly sequence: readonly string[];
  readonly steps: readonly ApiChallengeStep[];
  readonly question: string;
  readonly expected: ApiChallengeExpectation;
  readonly actual: ApiChallengeActual;
  readonly status: ApiChallengeStatus;
  readonly evidence: readonly string[];
  readonly remediation: string;
}

export function buildApiChallenges(contracts: readonly OperationContract[]): ApiChallenge[] {
  const ordered = [...contracts].sort(compareContracts);
  const challenges = [
    ...repeatChallenges(ordered),
    ...exclusiveChallenges(ordered),
    ...prerequisiteChallenges(ordered),
    ...terminalChallenges(ordered),
    ...fusionChallenges(ordered),
    ...aliasChallenges(ordered),
    ...combinationChallenges(ordered),
  ];
  return challenges.sort((left, right) => left.id.localeCompare(right.id));
}

function repeatChallenges(contracts: readonly OperationContract[]): ApiChallenge[] {
  const result: ApiChallenge[] = [];
  for (const contract of contracts) {
    if (contract.terminal) continue;
    const preparation = prepareRequirements(contract, contracts);
    if (!preparation) continue;
    const first = transition(preparation.state, contract);
    if (!first.valid) continue;
    const second = transition(first.state, contract);
    const expected: ApiChallengeExpectation =
      contract.repeat === "forbid" || contract.repeat === "explicit-replace" ? "invalid" : "valid";
    result.push(
      challenge({
        id: `repeat:${contract.id}`,
        kind: "repeat",
        steps: [...preparation.steps, contract, contract],
        question: `Does ${contract.name} -> ${contract.name} add a new semantic effect, or is it a duplicate stage that TypeScript should stop offering?`,
        expected,
        actual: actualOf(second.valid),
        contracts: [contract],
        evidence: [
          `repeat semantics: ${contract.repeat}`,
          `semantic key: ${contract.semanticKey}`,
          second.reason ?? "the second transition was accepted",
        ],
        remediation:
          expected === "invalid"
            ? "Hide the repeated operation from the type surface and reject dynamic calls with a stable runtime error, unless an explicit replacement contract exists."
            : "Keep the operation available only when repetition has an intentional accumulation or idempotence contract; add a focused runtime and type-level proof.",
      })
    );
  }
  return result;
}

function exclusiveChallenges(contracts: readonly OperationContract[]): ApiChallenge[] {
  const groups = new Map<string, OperationContract[]>();
  for (const contract of contracts) {
    if (!contract.exclusiveGroup) continue;
    const group = groups.get(contract.exclusiveGroup) ?? [];
    group.push(contract);
    groups.set(contract.exclusiveGroup, group);
  }
  const result: ApiChallenge[] = [];
  for (const [groupName, members] of groups) {
    const orderedMembers = members.sort(compareContracts);
    for (let index = 0; index < orderedMembers.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < orderedMembers.length; nextIndex += 1) {
        const left = orderedMembers[index];
        const right = orderedMembers[nextIndex];
        const first = transition(initialState(), left);
        const second = first.valid ? transition(first.state, right) : first;
        result.push(
          challenge({
            id: `exclusive:${groupName}:${left.id}:${right.id}`,
            kind: "exclusive",
            steps: [left, right],
            question: `Can ${left.name} combine with ${right.name}, or would that silently replace ${groupName} and need to disappear from the next TypeScript state?`,
            expected: "invalid",
            actual: actualOf(second.valid),
            contracts: [left, right],
            evidence: [
              `exclusive group: ${groupName}`,
              `${left.name} -> ${right.name}: ${second.reason ?? "accepted"}`,
            ],
            remediation:
              "Reject the second singleton policy in the type and runtime surfaces, or introduce an explicit replacement operation with documented semantics.",
          })
        );
      }
    }
  }
  return result;
}

function prerequisiteChallenges(contracts: readonly OperationContract[]): ApiChallenge[] {
  const result: ApiChallenge[] = [];
  for (const contract of contracts) {
    if (contract.requires.length === 0) continue;
    const initial = transition(initialState(), contract);
    const preparation = prepareRequirements(contract, contracts);
    const satisfied = preparation ? transition(preparation.state, contract) : undefined;
    const providerNames = preparation?.steps.map((step) => step.name).join(" -> ") ?? "no provider found";
    const actual = actualOf(initial.valid);
    const expected: ApiChallengeExpectation = "invalid";
    const status: ApiChallengeStatus = !initial.valid && satisfied?.valid ? reviewedStatus([contract]) : "blocked";
    result.push({
      id: `prerequisite:${contract.id}`,
      kind: "prerequisite",
      sequence: [contract.name],
      steps: [contract],
      question: `Can ${contract.name} be used before its required capability exists, or should TypeScript hide it until the prerequisite is present?`,
      expected,
      actual,
      status,
      evidence: [
        `requires: ${contract.requires.join(", ")}`,
        `provider path: ${providerNames}`,
        initial.reason ?? "the initial transition was accepted",
        satisfied?.reason ??
          (satisfied ? "the provider path satisfies the requirement" : "the provider path cannot be evaluated"),
      ],
      remediation:
        "Keep the operation unavailable until its prerequisite is present and prove the legal provider path with runtime and type-level tests.",
    });
  }
  return result;
}

function terminalChallenges(contracts: readonly OperationContract[]): ApiChallenge[] {
  const continuations = contracts.filter((contract) => !contract.terminal).sort(compareContracts);
  const continuation = continuations.find((contract) => contract.name === "refine") ?? continuations[0];
  if (!continuation) return [];
  const result: ApiChallenge[] = [];
  for (const terminal of contracts.filter((contract) => contract.terminal).sort(compareContracts)) {
    const first = transition(initialState(), terminal);
    if (!first.valid) continue;
    const second = transition(first.state, continuation);
    result.push(
      challenge({
        id: `terminal:${terminal.id}:${continuation.id}`,
        kind: "terminal",
        steps: [terminal, continuation],
        question: `After ${terminal.name} closes the chain, can ${continuation.name} still be appended, or should TypeScript stop offering it?`,
        expected: "invalid",
        actual: actualOf(second.valid),
        contracts: [terminal, continuation],
        evidence: [second.reason ?? "terminal continuation was accepted"],
        remediation:
          "Keep terminal states closed in the fluent type and reject dynamic continuation before code generation.",
      })
    );
  }
  return result;
}

function fusionChallenges(contracts: readonly OperationContract[]): ApiChallenge[] {
  const result: ApiChallenge[] = [];
  for (const contract of contracts) {
    for (const reference of contract.fusesWith ?? []) {
      const partner = findReferencedContract(reference, contracts);
      if (!partner) {
        result.push({
          id: `fusion:${contract.id}:${referenceKey(reference)}`,
          kind: "fusion",
          sequence: [reference, contract.name],
          steps: [contract],
          question: `Does ${reference} fuse with ${contract.name} as one semantic pipeline?`,
          expected: "valid",
          actual: "invalid",
          status: "blocked",
          evidence: [`fusion partner ${reference} was not found in the public fluent inventory`],
          remediation:
            "Expose the real operation in the inventory or remove the fusion declaration until the public contract exists.",
        });
        continue;
      }
      const first = transition(initialState(), partner);
      const second = first.valid ? transition(first.state, contract) : first;
      result.push(
        challenge({
          id: `fusion:${partner.id}:${referenceKey(reference)}:${contract.id}`,
          kind: "fusion",
          steps: [partner, contract],
          question: `Does ${partner.name} combine with ${contract.name} as one semantic pipeline rather than two duplicated stages?`,
          expected: "valid",
          actual: actualOf(second.valid),
          contracts: [partner, contract],
          evidence: [`declared fusion: ${reference}`, second.reason ?? "the composed transition is legal"],
          remediation:
            "Keep the composition legal and add a differential test proving that the fused pipeline runs the semantic stage once.",
        })
      );
    }
  }
  return result;
}

function aliasChallenges(contracts: readonly OperationContract[]): ApiChallenge[] {
  const groups = new Map<string, OperationContract[]>();
  for (const contract of contracts) {
    if (!contract.aliases || contract.aliases.length === 0) continue;
    const group = groups.get(contract.semanticKey) ?? [];
    group.push(contract);
    groups.set(contract.semanticKey, group);
  }
  const result: ApiChallenge[] = [];
  for (const [semanticKey, members] of groups) {
    const orderedMembers = members.sort(compareContracts);
    for (let index = 0; index < orderedMembers.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < orderedMembers.length; nextIndex += 1) {
        const left = orderedMembers[index];
        const right = orderedMembers[nextIndex];
        const first = transition(initialState(), left);
        const second = first.valid ? transition(first.state, right) : first;
        result.push({
          id: `alias:${semanticKey}:${left.id}:${right.id}`,
          kind: "alias",
          sequence: [left.name, right.name],
          steps: [left, right],
          question: `Do ${left.name} and ${right.name} represent the same intent, and if so should this chain be legal, redundant, or an explicit replacement?`,
          expected: "decision-required",
          actual: actualOf(second.valid),
          status: "needs-design",
          evidence: [
            `shared semantic key: ${semanticKey}`,
            `${left.name} -> ${right.name}: ${second.reason ?? "accepted"}`,
          ],
          remediation:
            "Choose one semantic policy: allow accumulation with documented meaning, reject the second alias in types and runtime, or add an explicit replacement operation.",
        });
      }
    }
  }
  return result;
}

function combinationChallenges(contracts: readonly OperationContract[]): ApiChallenge[] {
  const result: ApiChallenge[] = [];
  for (const contract of contracts) {
    const partner = relatedPartner(contract, contracts);
    if (!partner) continue;
    const first = transition(initialState(), contract);
    const second = first.valid ? transition(first.state, partner) : first;
    result.push({
      id: `combination:${contract.id}:${partner.id}`,
      kind: "combination",
      sequence: [contract.name, partner.name],
      steps: [contract, partner],
      question: `Does ${contract.name} combine with ${partner.name} in this order, and is the result valid, redundant, or fused?`,
      expected: "decision-required",
      actual: actualOf(second.valid),
      status: "needs-design",
      evidence: [
        `selected deterministic partner from family ${partner.family}`,
        second.reason ?? "the transition is currently accepted",
      ],
      remediation:
        "Record the intended transition in the semantic contract. If it is invalid, remove it from the type surface and reject dynamic calls; if valid, document its ordering and fusion behavior.",
    });
  }
  return result;
}

function relatedPartner(
  contract: OperationContract,
  contracts: readonly OperationContract[]
): OperationContract | undefined {
  const sameFamily = contracts.filter(
    (candidate) =>
      candidate.id !== contract.id &&
      candidate.family === contract.family &&
      candidate.semanticKey !== contract.semanticKey &&
      !candidate.terminal
  );
  return sameFamily.sort(compareContracts)[0] ?? contracts.find((candidate) => candidate.id !== contract.id);
}

function prepareRequirements(
  contract: OperationContract,
  contracts: readonly OperationContract[],
  visiting = new Set<string>()
): { readonly state: GrammarState; readonly steps: readonly OperationContract[] } | undefined {
  if (contract.requires.length === 0) return { state: initialState(), steps: [] };
  if (visiting.has(contract.id)) return undefined;
  const nextVisiting = new Set(visiting).add(contract.id);
  let state = initialState();
  const steps: OperationContract[] = [];
  for (const required of contract.requires) {
    if (state.capabilities.has(required)) continue;
    const provider = contracts
      .filter(
        (candidate) => candidate.id !== contract.id && candidate.provides.includes(required) && !candidate.terminal
      )
      .sort(compareContracts)[0];
    if (!provider) return undefined;
    const providerPreparation = prepareRequirements(provider, contracts, nextVisiting);
    if (!providerPreparation) return undefined;
    for (const prerequisite of providerPreparation.steps) {
      const result = transition(state, prerequisite);
      if (!result.valid) return undefined;
      state = result.state;
      steps.push(prerequisite);
    }
    const result = transition(state, provider);
    if (!result.valid) return undefined;
    state = result.state;
    steps.push(provider);
  }
  return { state, steps };
}

function findReferencedContract(
  reference: string,
  contracts: readonly OperationContract[]
): OperationContract | undefined {
  const name = reference.includes(".") ? reference.slice(reference.lastIndexOf(".") + 1) : reference;
  return contracts.find((contract) => contract.name === name);
}

function referenceKey(reference: string): string {
  return reference.replace(/[^a-zA-Z0-9]+/g, "-");
}

function challenge(input: {
  readonly id: string;
  readonly kind: ApiChallengeKind;
  readonly steps: readonly OperationContract[];
  readonly question: string;
  readonly expected: ApiChallengeExpectation;
  readonly actual: ApiChallengeActual;
  readonly contracts: readonly OperationContract[];
  readonly evidence: readonly string[];
  readonly remediation: string;
}): ApiChallenge {
  const status =
    input.expected !== "decision-required" && input.expected !== input.actual
      ? "blocked"
      : input.expected === "decision-required"
        ? "needs-design"
        : reviewedStatus(input.contracts);
  return {
    id: input.id,
    kind: input.kind,
    sequence: input.steps.map((step) => step.name),
    steps: input.steps.map(stepOf),
    question: input.question,
    expected: input.expected,
    actual: input.actual,
    status,
    evidence: input.evidence,
    remediation: input.remediation,
  };
}

function reviewedStatus(contracts: readonly OperationContract[]): ApiChallengeStatus {
  return contracts.every((contract) => contract.audit === "reviewed") ? "verified" : "needs-design";
}

function stepOf(contract: OperationContract): ApiChallengeStep {
  return {
    id: contract.id,
    name: contract.name,
    family: contract.family,
    semanticKey: contract.semanticKey,
  };
}

function actualOf(valid: boolean): ApiChallengeActual {
  return valid ? "valid" : "invalid";
}

function compareContracts(left: OperationContract, right: OperationContract): number {
  return [left.family, left.name, left.id]
    .join("\u0000")
    .localeCompare([right.family, right.name, right.id].join("\u0000"));
}
