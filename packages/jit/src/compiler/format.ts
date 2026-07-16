import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { countFormatPlaceholders, emitFormatMaskExpression, emitStrictFormatCondition } from "./source/format-mask.js";
import { emitLiteral } from "./source/literal.js";

/** A string formatter specialized from declarative `.format()` and `.phoneBR()` checks. */
export type Format = (value: string) => string;

/** Emits a dependency-free formatter function suitable for AOT output. */
export function emitFormatSource(schema: ATS.AnyTypeSchema): string {
  if (schema.type !== TypeName.string) {
    throw new JITError("UNSUPPORTED_SCHEMA", "format compilation requires a string schema");
  }

  const checks = (schema.def as { readonly checks?: readonly ATS.StringCheck[] }).checks ?? [];
  const selected = checks.filter((check) => check.kind === "format" || check.kind === "phoneBR");

  if (selected.length === 0) {
    throw new JITError("UNSUPPORTED_SCHEMA", "format compilation requires .format(), .cpf(), .cnpj(), or .phoneBR()");
  }

  const lines = [
    "function format(value) {",
    '  if (typeof value !== "string") throw new TypeError("format expects a string");',
    "  let output = value;",
  ];

  for (const check of selected) {
    if (check.kind === "phoneBR") {
      lines.push('  output = output.replace(/\\D+/g, "");');
      lines.push(
        '  if (output.length !== 10 && output.length !== 11) throw new RangeError("format expected 10 or 11 digits");'
      );
      lines.push(
        `  output = output.length === 10 ? ${emitFormatMaskExpression("output", "(##) ####-####")} : ${emitFormatMaskExpression("output", "(##) #####-####")};`
      );
      continue;
    }

    const spec = check.value as ATS.StringMaskSpec;

    if (spec.mode === "strict") {
      lines.push(
        `  if (${emitStrictFormatCondition("output", spec.pattern)}) throw new RangeError(${emitLiteral(`format expected ${spec.pattern}`)});`
      );
      continue;
    }

    const length = countFormatPlaceholders(spec.pattern);

    if (spec.stripNonDigits) lines.push('  output = output.replace(/\\D+/g, "");');
    lines.push(
      `  if (output.length !== ${length}) throw new RangeError(${emitLiteral(`format expected ${length} characters`)});`
    );
    lines.push(`  output = ${emitFormatMaskExpression("output", spec.pattern)};`);
  }

  lines.push("  return output;", "}");
  return lines.join("\n");
}

/** Compiles and identity-caches a formatter for one string schema. */
export function compileFormat(schema: ATS.StringSchema, options?: CompileCacheOptions): Format {
  return getCompileCached(
    schema,
    "format",
    () => {
      const compiled = globalThis.Function(`return (${emitFormatSource(schema)});`)() as Format;

      registerArtifact(compiled as object, { kind: "operation", schema, op: "format" });
      return compiled;
    },
    options
  );
}
