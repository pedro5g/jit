import type { AotOutputFormat } from "@jit-compiler/jit/aot";

export interface LabCompilerRequest {
  readonly id: number;
  readonly code: string;
  readonly names: readonly string[];
  readonly options: {
    readonly format: AotOutputFormat;
    readonly fileName: string;
  };
}

export interface LabCompilerFile {
  readonly path: string;
  readonly source: string;
}

export interface LabCompilerResult {
  readonly files: readonly LabCompilerFile[];
  readonly skipped: readonly { readonly operation: string; readonly reason: string; readonly schema: string }[];
}

export type LabCompilerResponse =
  | { readonly id: number; readonly ok: true; readonly result: LabCompilerResult }
  | { readonly id: number; readonly ok: false; readonly error: string };
