import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { emitScrub, type ScrubAction } from "./security/emit-scrub.js";

/**
 * A compiled PII-masking function: returns a copy of the value with every
 * `.pii()` field replaced. Untouched subtrees keep their identity.
 *
 * @template T - The value type described by the schema.
 */
export type Mask<T = unknown> = (value: T) => T;

type PiiStrategy = "redact" | "mask" | "hash";

/**
 * Emits the JavaScript source of a compiled masking function.
 *
 * @param schema - The schema whose `.pii()` fields drive the rewrite.
 * @returns The generated masking source.
 */
export function emitMaskSource(schema: ATS.AnyTypeSchema): string {
  return emitScrub(schema, selectPii).source;
}

/**
 * Compiles a PII-masking function for LGPD/GDPR-safe logs and responses.
 *
 * Fields marked with `.pii(strategy)` are replaced inline:
 * - `"redact"` (default): strings become `"***"`, numbers become `0`.
 * - `"mask"`: strings keep their last 4 characters (`"***1234"`), numbers become `0`.
 * - `"hash"`: inline FNV-1a (`Math.imul`), strings → hex digest, numbers → numeric hash.
 *
 * Only the paths that contain PII are rebuilt — everything else is reused by
 * reference, so masking a large object costs a handful of allocations.
 * Schemas with no `.pii()` fields compile to the identity function.
 *
 * @throws JITError with code `UNSUPPORTED_SCHEMA` when a `.pii()` field is
 * not a string or number, or PII sits inside an unsupported container.
 */
export function compileMask<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  options?: CompileCacheOptions
): Mask<ATS.InferSchema<TSchema>> {
  return getCompileCached(
    schema,
    "mask",
    () => {
      const emitted = emitScrub(schema, selectPii);

      const compiled = globalThis.Function(
        `return ${emitted.source.replace("function scrub", "function mask")};`
      )() as Mask<ATS.InferSchema<TSchema>>;

      registerArtifact(compiled as object, { kind: "operation", schema, op: "mask" });
      return compiled;
    },
    options
  );
}

function selectPii(base: ATS.AnyTypeSchema & { readonly def: Record<string, unknown> }): ScrubAction | undefined {
  const strategy = base.def.pii as PiiStrategy | undefined;

  if (strategy === undefined) return undefined;

  const isString = base.type === TypeName.string;
  const isNumber = base.type === TypeName.number || base.type === TypeName.int;

  if (!isString && !isNumber) {
    throw new JITError("UNSUPPORTED_SCHEMA", `pii masking supports string and number fields; found ${base.type}`);
  }

  switch (strategy) {
    case "redact":
      return () => (isString ? '"***"' : "0");
    case "mask":
      return (value) => (isString ? `(${value}.length > 4 ? "***" + ${value}.slice(-4) : "***")` : "0");
    case "hash":
      return (value, writer, nextVar) => {
        if (!isString) return `(Math.imul(2166136261 ^ ${value}, 16777619) >>> 0)`;

        const hash = nextVar("h");
        const index = nextVar("i");

        writer.line(`let ${hash} = 2166136261;`);
        writer.line(`for (let ${index} = 0; ${index} < ${value}.length; ${index}++) {`);
        writer.indent(() => {
          writer.line(`${hash} = Math.imul(${hash} ^ ${value}.charCodeAt(${index}), 16777619);`);
        });
        writer.line("}");
        return `(${hash} >>> 0).toString(16)`;
      };
  }
}
