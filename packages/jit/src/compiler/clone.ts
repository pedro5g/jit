import type * as ATS from "../core/ats/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { buildCloneIR } from "./clone/build-clone-ir.js";
import { emitClone, emitCloneBodyWithBindings } from "./clone/emit-clone.js";

/**
 * A compiled deep-clone function.
 *
 * @template T - The value type described by the schema the clone was compiled from.
 * @param value - The value to clone.
 * @returns A deep clone of `value`.
 */
export type Clone<T = unknown> = (value: T) => T;
/** Describes the JIT clone method contract used by the public API. */
export type CloneMethod<T = unknown> = (this: T) => T;

/**
 * Emits the JavaScript source of a schema-aware deep-clone function.
 *
 * Useful for inspection, testing, and AOT pipelines that persist generated code.
 *
 * @param schema - The schema used to build the clone IR.
 * @returns The complete JavaScript source for the generated clone function.
 */
export function emitCloneSource(schema: ATS.AnyTypeSchema): string {
  return emitClone(buildCloneIR(schema));
}

/**
 * Compiles a schema-aware deep-clone function.
 *
 * The generated code copies known properties directly (object literals, typed
 * loops) instead of walking values generically, so it stays monomorphic.
 *
 * @template TSchema - The schema driving both codegen and the inferred value type.
 * @param schema - The schema used to compile the clone function.
 * @returns A specialized clone function for values inferred from `schema`.
 *
 * @example
 * ```ts
 * const clone = compileClone(User.schema);
 * const copy = clone(user); // deep copy, new identity at every level
 * ```
 */
export function compileClone<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  options?: CompileCacheOptions
): Clone<ATS.Typeof<TSchema>> {
  return getCompileCached(
    schema,
    "clone",
    () => {
      const program = buildCloneIR(schema);
      const emitted = emitCloneBodyWithBindings(program);

      const compiled = globalThis.Function(
        ...emitted.bindings.names,
        `return function clone(value) {\n${emitted.source}\n};`
      )(...emitted.bindings.values) as Clone<ATS.Typeof<TSchema>>;

      registerArtifact(compiled as object, {
        kind: "operation",
        schema,
        op: "clone",
      });
      return compiled;
    },
    options
  );
}

/** Compiles a clone method that re-enters the receiver's trusted materializer. */
export function compileCloneMethod<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  options?: CompileCacheOptions
): CloneMethod<ATS.TypeofSchema<TSchema>> {
  return getCompileCached(
    schema,
    "clone:method",
    () => {
      const emitted = emitCloneBodyWithBindings(buildCloneIR(schema));
      return globalThis.Function(
        ...emitted.bindings.names,
        `return function clone() {
const value = this;
return this.constructor["__jitMaterialize"]((() => {
${emitted.source}
})());
};`
      )(...emitted.bindings.values) as CloneMethod<ATS.TypeofSchema<TSchema>>;
    },
    options
  );
}
