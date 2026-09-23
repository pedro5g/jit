/** Restricted operation set available to semantic extensions. */
export type ExtensionIRNode =
  | { readonly kind: "load"; readonly path: readonly PropertyKey[] }
  | { readonly kind: "literal"; readonly value: string | number | boolean | null }
  | { readonly kind: "compare"; readonly operator: "eq" | "neq" | "lt" | "lte" | "gt" | "gte" }
  | { readonly kind: "branch"; readonly when: number; readonly then: number; readonly otherwise?: number }
  | { readonly kind: "loop"; readonly body: number; readonly count?: number }
  | { readonly kind: "callIntrinsic"; readonly name: string; readonly args: readonly number[] }
  | { readonly kind: "emitIssue"; readonly code: string; readonly params?: Readonly<Record<string, unknown>> }
  | { readonly kind: "transform"; readonly input: number }
  | { readonly kind: "return"; readonly value?: number };

/** Immutable IR supplied by semantic extensions; source emission remains private. */
export interface ExtensionIR {
  readonly version: 1;
  readonly nodes: readonly ExtensionIRNode[];
  readonly result: number;
}
