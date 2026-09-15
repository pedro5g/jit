import type { OperationContract } from "./contracts.js";

export interface GrammarState {
  readonly capabilities: ReadonlySet<string>;
  readonly exclusive: ReadonlyMap<string, string>;
  readonly terminal: boolean;
  readonly operations: readonly string[];
}

export interface TransitionResult {
  readonly valid: boolean;
  readonly state: GrammarState;
  readonly reason?: string;
}

export function initialState(): GrammarState {
  return { capabilities: new Set(), exclusive: new Map(), terminal: false, operations: [] };
}

export function transition(state: GrammarState, operation: OperationContract): TransitionResult {
  if (state.terminal) return invalid(state, `terminal state cannot accept ${operation.name}`);
  if (operation.repeat === "forbid" && state.capabilities.has(operation.id))
    return invalid(state, `repeated singleton transition: ${operation.name}`);
  for (const required of operation.requires)
    if (!state.capabilities.has(required)) return invalid(state, `${operation.name} requires ${required}`);
  if (operation.exclusiveGroup) {
    const existing = state.exclusive.get(operation.exclusiveGroup);
    if (existing && existing !== operation.name)
      return invalid(state, `${existing} conflicts with ${operation.name} in ${operation.exclusiveGroup}`);
  }
  if (
    (operation.conflicts ?? []).some(
      (group) => state.exclusive.has(group) && state.exclusive.get(group) !== operation.name
    )
  )
    return invalid(state, `${operation.name} conflicts with an active exclusive group`);
  const capabilities = new Set(state.capabilities);
  capabilities.add(operation.id);
  for (const capability of operation.provides) capabilities.add(capability);
  const exclusive = new Map(state.exclusive);
  if (operation.exclusiveGroup) exclusive.set(operation.exclusiveGroup, operation.name);
  return {
    valid: true,
    state: {
      capabilities,
      exclusive,
      terminal: operation.terminal === true,
      operations: [...state.operations, operation.name],
    },
  };
}

function invalid(state: GrammarState, reason: string): TransitionResult {
  return { valid: false, state, reason };
}
