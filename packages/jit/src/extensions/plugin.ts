import type { SemanticFact } from "../compiler/facts/schema-facts.js";
import type { StrategyCheck, StrategyContext, StrategyEstimate } from "../compiler/strategy/candidate.js";
import type { TargetProfile } from "../compiler/target/target-profile.js";
import type { ExtensionIR } from "./extension-ir.js";
import type { ExtensionGrammar } from "./grammar.js";

/** Stable identity required for every compiler extension. */
export interface PluginIdentity {
  readonly id: string;
  readonly version: string;
  readonly abi: number;
  /** Schema metadata keys this extension is allowed to inspect during lowering. */
  readonly metadataDependencies?: readonly string[];
}

/** Composition-level operator: built-in schemas remain the lowering boundary. */
export interface CompositionOperator extends PluginIdentity {
  readonly kind: "composition";
  readonly name: string;
  readonly target: string;
  readonly grammar: ExtensionGrammar;
  readonly compose: (schema: unknown) => unknown;
}

/** Semantic operator lowered through restricted extension IR. */
export interface SemanticOperator extends PluginIdentity {
  readonly kind: "semantic";
  readonly name: string;
  readonly grammar: ExtensionGrammar;
  readonly lower: (context: SemanticExtensionContext) => ExtensionIR;
}

/** Schema facts available to semantic lowering; no target or emitter is exposed. */
export interface SemanticExtensionContext {
  readonly schema: unknown;
  readonly facts: readonly SemanticFact[];
  /** Metadata filtered to the extension's declared dependencies. */
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly operation?: string;
}

/** Advanced physical candidate contract; it contributes a core-validated IR body. */
export interface StrategyOperator extends PluginIdentity {
  readonly kind: "strategy";
  readonly family: string;
  readonly candidate: string;
  readonly optimized: boolean;
  readonly portability: "portable" | "target-specific";
  readonly evidence: readonly string[];
  readonly grammar: ExtensionGrammar;
  readonly legality: (context: StrategyContext) => StrategyCheck;
  readonly targetSupport: (context: StrategyContext, profile: TargetProfile) => StrategyCheck;
  readonly estimate: (context: StrategyContext, profile: TargetProfile) => StrategyEstimate;
  readonly lower: (context: StrategyContext) => ExtensionIR;
}

/** A plugin contribution accepted by an isolated JIT environment. */
export type ExtensionDescriptor = CompositionOperator | SemanticOperator | StrategyOperator;

/** Plugin factory input for composition operators. */
/** Input accepted by `JIT.plugin.operator`; omitted identity fields receive stable defaults. */
export type CompositionOperatorInput = Omit<CompositionOperator, "kind" | keyof PluginIdentity> &
  Partial<PluginIdentity>;
/** Input accepted by `JIT.plugin.semantic`; omitted identity fields receive stable defaults. */
export type SemanticOperatorInput = Omit<SemanticOperator, "kind" | keyof PluginIdentity> & Partial<PluginIdentity>;
/** Input accepted by `JIT.plugin.strategy`; omitted identity fields receive stable defaults. */
export type StrategyOperatorInput = Omit<StrategyOperator, "kind" | keyof PluginIdentity> & Partial<PluginIdentity>;

/** Plugin factory namespace exposed under `JIT.plugin`. */
export const plugin = Object.freeze({
  /** Creates a composition plugin expressed through existing schema builders. */
  operator<const T extends CompositionOperatorInput>(descriptor: T): T & CompositionOperator {
    return Object.freeze(withIdentity(descriptor, "composition")) as T & CompositionOperator;
  },
  /** Creates a semantic plugin lowered through the restricted extension IR. */
  semantic<const T extends SemanticOperatorInput>(descriptor: T): T & SemanticOperator {
    return Object.freeze(withIdentity(descriptor, "semantic")) as T & SemanticOperator;
  },
  /** Creates an advanced physical candidate plugin. */
  strategy<const T extends StrategyOperatorInput>(descriptor: T): T & StrategyOperator {
    return Object.freeze(withIdentity(descriptor, "strategy")) as T & StrategyOperator;
  },
});

function withIdentity<T extends object, TKind extends ExtensionDescriptor["kind"]>(
  descriptor: T,
  kind: TKind
): T & {
  readonly kind: TKind;
  readonly id: string;
  readonly version: string;
  readonly abi: number;
} {
  const values = descriptor as Record<string, unknown>;
  const name = typeof values.name === "string" ? values.name : typeof values.family === "string" ? values.family : kind;
  return {
    ...descriptor,
    kind,
    id: typeof values.id === "string" ? values.id : `@jit/${name}`,
    version: typeof values.version === "string" ? values.version : "0.0.0",
    abi: typeof values.abi === "number" ? values.abi : 1,
  } as T & {
    readonly kind: TKind;
    readonly id: string;
    readonly version: string;
    readonly abi: number;
  };
}
