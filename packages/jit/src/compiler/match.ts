import * as ATS from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { resolveWrappers } from "./resolvers/resolve-wrappers.js";
import { emitPropertyAccess } from "./source/access.js";
import { emitLiteral } from "./source/literal.js";

export interface MatchDescriptor {
  readonly schema: ATS.AnyTypeSchema;
  readonly discriminator: string;
  /** Every tag the union declares, in declaration order. */
  readonly tags: readonly (string | number | boolean)[];
  /** Tags a case was given for, in the order the cases were declared. */
  readonly handled: readonly (string | number | boolean)[];
  readonly hasFallback: boolean;
  readonly exhaustive: boolean;
}

type DiscriminatedUnion = ATS.AnyTypeSchema & { readonly def: ATS.DiscriminatedUnionDef };

export function resolveMatchDescriptor(
  schema: ATS.AnyTypeSchema,
  handled: readonly (string | number | boolean)[],
  hasFallback: boolean,
  exhaustive: boolean
): MatchDescriptor {
  const base = resolveWrappers(schema).base;

  if (base.type !== ATS.TypeName.discriminatedUnion) {
    throw new JITError("UNSUPPORTED_SCHEMA", "JIT.match() requires a discriminated union");
  }

  const union = base as DiscriminatedUnion;
  const discriminator = union.def.discriminator;
  const tags = union.def.options.map((option) => tagOf(option, discriminator));

  for (const tag of handled) {
    if (!tags.includes(tag)) {
      throw new JITError(
        "UNSUPPORTED_SCHEMA",
        `JIT.match() has a case for ${JSON.stringify(tag)}, which the union does not declare`
      );
    }
  }

  if (exhaustive && !hasFallback) {
    const missing = tags.filter((tag) => !handled.includes(tag));

    if (missing.length > 0) {
      throw new JITError(
        "UNSUPPORTED_SCHEMA",
        `JIT.match().exhaustive() is missing a case for ${missing.map((tag) => JSON.stringify(tag)).join(", ")}`
      );
    }
  }

  return Object.freeze({
    schema: base,
    discriminator,
    tags: Object.freeze(tags),
    handled: Object.freeze([...handled]),
    hasFallback,
    exhaustive,
  });
}

function tagOf(option: ATS.AnyTypeSchema, discriminator: string): string | number | boolean {
  const base = resolveWrappers(option).base;
  const field = (base as ATS.AnyTypeSchema & { readonly def: ATS.ObjectDef }).def?.props?.[discriminator];
  const literal = field === undefined ? undefined : resolveWrappers(field).base;

  if (literal?.type !== ATS.TypeName.literal) {
    throw new JITError(
      "UNSUPPORTED_SCHEMA",
      `JIT.match() requires every option to declare ${JSON.stringify(discriminator)} as a literal`
    );
  }
  return (literal.def as { readonly value: string | number | boolean }).value;
}

/**
 * Emits the dispatch.
 *
 * The tags are literals declared by the schema, so this is a `switch` the
 * engine can turn into a jump — not a chain of `if`s over a handler map, and
 * not a lookup that allocates. An exhaustive match still keeps a throwing
 * default as a runtime boundary guard for values smuggled in from untyped code.
 */
export function emitMatchSource(descriptor: MatchDescriptor): string {
  const writer = new CodeWriter();
  const read = emitPropertyAccess("value", descriptor.discriminator);

  writer.line("function match(value) {");
  writer.indent(() => {
    writer.line(`switch (${read}) {`);
    writer.indent(() => {
      descriptor.handled.forEach((tag, index) => {
        writer.line(`case ${emitLiteral(tag as never)}:`);
        writer.indent(() => writer.line(`return __case${index}(value);`));
      });

      if (descriptor.hasFallback) {
        writer.line("default:");
        writer.indent(() => writer.line("return __fallback(value);"));
        return;
      }

      // An exhaustive match covered every declared tag, so reaching here means
      // the value did not come from this union.
      writer.line("default:");
      writer.indent(() =>
        writer.line(
          `throw new Error("unmatched " + ${JSON.stringify(descriptor.discriminator)} + ": " + String(${read}));`
        )
      );
    });
    writer.line("}");
  });
  writer.line("}");
  return writer.toString();
}

export function matchCacheKey(descriptor: MatchDescriptor): string {
  return `match:${descriptor.discriminator}:${JSON.stringify(descriptor.handled)}:${descriptor.hasFallback}`;
}

export function compileMatch<TValue, TResult>(
  descriptor: MatchDescriptor,
  handlers: readonly ((value: TValue) => TResult)[],
  fallback: ((value: TValue) => TResult) | undefined,
  options?: CompileCacheOptions
): (value: TValue) => TResult {
  const names = descriptor.handled.map((_, index) => `__case${index}`);
  const template = getCompileCached(
    descriptor.schema,
    matchCacheKey(descriptor),
    () => {
      const source = emitMatchSource(descriptor);
      return {
        source,
        create: globalThis.Function(...names, ...(descriptor.hasFallback ? ["__fallback"] : []), `return ${source};`),
      };
    },
    options
  );
  const compiled = template.create(...handlers, ...(fallback === undefined ? [] : [fallback])) as (
    value: TValue
  ) => TResult;

  registerArtifact(compiled as object, {
    kind: "match-plan",
    schema: descriptor.schema,
    descriptor,
    bindingNames: names.concat(descriptor.hasFallback ? "__fallback" : []),
    bindingValues: handlers.concat(fallback === undefined ? [] : [fallback]),
  });
  return compiled;
}
