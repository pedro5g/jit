/** Semantic expression or control-flow node; references are stable local indexes. */
export type ExtensionIRNode =
  | { readonly kind: "load"; readonly path: readonly (string | number)[] }
  | { readonly kind: "literal"; readonly value: string | number | boolean | null }
  | {
      readonly kind: "compare";
      readonly operator: "eq" | "neq" | "lt" | "lte" | "gt" | "gte";
      readonly left: number;
      readonly right: number;
    }
  | { readonly kind: "logical"; readonly operator: "and" | "or"; readonly operands: readonly number[] }
  | { readonly kind: "not"; readonly input: number }
  | { readonly kind: "branch"; readonly when: number; readonly then: number; readonly otherwise?: number }
  | { readonly kind: "loop"; readonly body: number; readonly count?: number }
  | { readonly kind: "callIntrinsic"; readonly name: ExtensionIntrinsic; readonly args: readonly number[] }
  | { readonly kind: "emitIssue"; readonly code: string; readonly params?: Readonly<Record<string, unknown>> }
  | { readonly kind: "transform"; readonly input: number; readonly intrinsic?: ExtensionTransform }
  | { readonly kind: "return"; readonly value?: number };

/** Portable, compiler-owned operations callable from extension IR. */
export type ExtensionIntrinsic =
  | "isString"
  | "isNumber"
  | "isBoolean"
  | "isBigint"
  | "isSymbol"
  | "isFunction"
  | "isArray"
  | "isNull"
  | "isDefined"
  | "stringLength"
  | "arrayLength";

/** String transforms implemented by the core compiler. */
export type ExtensionTransform = "string.toLowerCase" | "string.toUpperCase" | "string.trim";

/** Declarative extension program containing only portable compiler nodes. */
export interface ExtensionIR {
  readonly version: 1;
  readonly nodes: readonly ExtensionIRNode[];
  /** Index of the unique terminal return node. */
  readonly result: number;
  /** Effects used by the program; every effect must be declared here. */
  readonly effects?: readonly ("issues" | "transform")[];
}

/** Type of a value proven by extension IR's local static checks. */
export type ExtensionValueType = "unknown" | "boolean" | "string" | "number" | "null";

/** Normalized and validated program passed to the operation-specific lowerer. */
export interface ValidatedExtensionIR {
  /** Frozen IR with stable node payload ordering. */
  readonly ir: ExtensionIR;
  /** Digest of the normalized IR, independent of object-key insertion order. */
  readonly digest: string;
  /** Statically known return type, or `unknown` when IR cannot prove it. */
  readonly resultType: ExtensionValueType;
  /** Declared effects after validation. */
  readonly effects: readonly ("issues" | "transform")[];
  /** True because only portable constants and core intrinsics are accepted. */
  readonly portable: true;
}

import { validateExtensionIR as validateExtensionIRImpl } from "./extension-ir-validator.js";

/** Validates structure, references, types, effects, and portable constants before lowering. */
export function validateExtensionIR(input: ExtensionIR): ValidatedExtensionIR {
  return validateExtensionIRImpl(input);
}
