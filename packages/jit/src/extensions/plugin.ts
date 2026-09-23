import type { ExtensionIR } from "./extension-ir.js";
import type { ExtensionGrammar } from "./grammar.js";

/** Stable identity required for every compiler extension. */
export interface PluginIdentity {
  readonly id: string;
  readonly version: string;
  readonly abi: number;
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
  readonly lower: (context: unknown) => ExtensionIR;
}

/** Advanced physical candidate contract; it cannot emit source directly. */
export interface StrategyOperator extends PluginIdentity {
  readonly kind: "strategy";
  readonly family: string;
  readonly grammar: ExtensionGrammar;
  readonly supports: (context: unknown) => boolean;
  readonly estimate: (context: unknown, profile: unknown) => unknown;
  readonly lower: (context: unknown) => unknown;
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
