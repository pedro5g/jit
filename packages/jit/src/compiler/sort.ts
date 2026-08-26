import type * as ATS from "../core/ats/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { emitOrderingComparatorBody, type OrderingDescriptor, resolveOrderingDescriptor } from "./ordering.js";

export interface CompiledSort<T> {
  (value: readonly T[]): T[];
  readonly compare: (left: T, right: T) => number;
  readonly inPlace: (value: T[]) => T[];
}

export function emitSortSource(descriptor: OrderingDescriptor): string {
  const writer = new CodeWriter();

  writer.line("(() => {");
  writer.indent(() => {
    writer.line("const compare = (left, right) => {");
    writer.indent(() => emitOrderingComparatorBody(writer, descriptor));
    writer.line("};");
    writer.line("const sort = (value) => {");
    writer.indent(() => {
      writer.line("const out = value.slice();");
      writer.line("out.sort(compare);");
      writer.line("return out;");
    });
    writer.line("};");
    writer.line("Object.defineProperties(sort, {");
    writer.indent(() => {
      writer.line("compare: { value: compare },");
      writer.line("inPlace: { value: (value) => value.sort(compare) },");
    });
    writer.line("});");
    writer.line("return sort;");
  });
  writer.line("})()");
  return writer.toString();
}

export function compileSort<T>(
  schema: ATS.AnyTypeSchema,
  descriptor: OrderingDescriptor,
  options?: CompileCacheOptions
): CompiledSort<T> {
  const ordering = resolveOrderingDescriptor(schema, descriptor.criteria);
  const cacheKey = `sort:${ordering.criteria.map(({ key, direction, valueKind, nullish }) => `${key}:${direction}:${valueKind}:${nullish}`).join(",")}`;
  const template = getCompileCached(
    schema,
    cacheKey,
    () => {
      const source = emitSortSource(ordering);
      return { source, create: globalThis.Function(`return ${source};`) };
    },
    options
  );
  const compiled = template.create() as CompiledSort<T>;

  registerArtifact(compiled, { kind: "sort-plan", schema, descriptor: ordering });
  return compiled;
}
