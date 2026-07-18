export const LAB_OPERATIONS = ["is", "parse", "safeParse", "equal", "clone", "diff", "hash", "stringify"] as const;
export type LabOperation = (typeof LAB_OPERATIONS)[number];
export type LabFieldType = "string" | "number" | "integer" | "boolean" | "stringArray";
export type LabStringFormat = "none" | "email" | "uuid" | "url";

export interface LabField {
  readonly name: string;
  readonly type: LabFieldType;
  readonly required: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly format?: LabStringFormat;
}

export interface LabCompileRequest {
  readonly name: string;
  readonly outputRoot: string;
  readonly fields: readonly LabField[];
  readonly operations: readonly LabOperation[];
}

export interface LabCompileResult {
  readonly files: readonly { readonly path: string; readonly source: string }[];
  readonly schemaSource: string;
  readonly skipped: readonly { readonly operation: string; readonly reason: string }[];
}
