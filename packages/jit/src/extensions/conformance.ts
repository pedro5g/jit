import { compileExtensionIR, emitExtensionIR } from "../compiler/extension-lowering.js";
import type { StrategyContext } from "../compiler/strategy/candidate.js";
import type { TargetProfile } from "../compiler/target/target-profile.js";
import { validateExtensionIR } from "./extension-ir.js";
import type { SemanticExtensionContext, SemanticOperator, StrategyOperator } from "./plugin.js";

/** Runs deterministic normalization and runtime/AOT-source checks for a semantic extension. */
export function assertSemanticExtensionConformance<TValue>(input: {
  readonly extension: SemanticOperator;
  readonly context: SemanticExtensionContext;
  readonly cases: readonly { readonly value: unknown; readonly expected: TValue }[];
}): void {
  const first = validateExtensionIR(input.extension.lower(input.context));
  const second = validateExtensionIR(input.extension.lower(input.context));
  if (first.digest !== second.digest) throw new Error(`semantic extension ${input.extension.id} is nondeterministic`);
  const source = emitExtensionIR(first.ir);
  if (source !== emitExtensionIR(second.ir))
    throw new Error(`semantic extension ${input.extension.id} emits unstable core IR`);
  const runtime = compileExtensionIR(first.ir);
  const standalone = globalThis.Function(source)() as (value: unknown) => unknown;
  for (const example of input.cases) {
    const expected = example.expected;
    if (!Object.is(runtime(example.value), expected) || !Object.is(standalone(example.value), expected))
      throw new Error(`semantic extension ${input.extension.id} disagrees with its conformance case`);
  }
}

/** Checks the legality, estimate, evidence, and restricted IR contract of a strategy contribution. */
export function assertStrategyExtensionConformance(input: {
  readonly extension: StrategyOperator;
  readonly context: StrategyContext;
  readonly target: TargetProfile;
}): void {
  const { extension, context, target } = input;
  if (extension.family !== context.family) throw new Error(`strategy extension ${extension.id} targets another family`);
  const legality = extension.legality(context);
  const targetSupport = extension.targetSupport(context, target);
  for (const [label, result] of [
    ["legality", legality],
    ["target support", targetSupport],
  ] as const) {
    if (typeof result.supported !== "boolean" || typeof result.reason !== "string" || result.reason.length === 0)
      throw new Error(`strategy extension ${extension.id} returned invalid ${label}`);
  }
  const estimate = extension.estimate(context, target);
  for (const dimension of ["runtime", "allocation", "setup", "codeSize", "cold", "branches"] as const) {
    const value = estimate[dimension];
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error(`strategy extension ${extension.id} returned invalid ${dimension} estimate`);
  }
  if (extension.optimized && extension.evidence.length === 0)
    throw new Error(`optimized strategy extension ${extension.id} has no evidence reference`);
  const first = validateExtensionIR(extension.lower(context));
  const second = validateExtensionIR(extension.lower(context));
  if (first.digest !== second.digest) throw new Error(`strategy extension ${extension.id} returns unstable IR`);
}
