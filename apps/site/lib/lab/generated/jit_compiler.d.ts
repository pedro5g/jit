import type { JIT as DefineJIT } from "@jit-compiler/jit/define";
import type { AotOutputFormat } from "@jit-compiler/jit/aot";

export const JIT: typeof DefineJIT;

export function compileBindings(
  bindings: Readonly<Record<string, unknown>>,
  options: {
    readonly format: AotOutputFormat;
    readonly fileName: string;
  }
): {
  readonly files: readonly { readonly path: string; readonly source: string }[];
  readonly skipped: readonly { readonly operation: string; readonly reason: string; readonly schema: string }[];
};
