import {
  appendNdjsonFilter,
  compileNdjsonParse,
  compileNdjsonStringify,
  createNdjsonDescriptor,
  type NdjsonDescriptor,
  type NdjsonInput,
  selectNdjson,
  withNdjsonSink,
} from "../compiler/ndjson.js";
import type { QueryConditionNode } from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { createConditionBuilder, lowerRulePredicate, type QueryConditionBuilder } from "./query.js";
import type { RulePredicate } from "./rules.js";

type NdjsonPick<TValue, TKeys extends keyof TValue> = { readonly [TKey in TKeys]: TValue[TKey] };

export interface NdjsonParsePlan<TRow, TOutput = TRow> {
  (input: NdjsonInput): TOutput[];
  validate(): NdjsonParsePlan<TRow, TOutput>;
  where(predicate: (query: QueryConditionBuilder<TRow>) => QueryConditionNode): NdjsonParsePlan<TRow, TOutput>;
  /**
   * Filters by a compiled rule predicate, fused into the same parse loop. The
   * rule lowers into the shared condition AST and its inputs become bindings,
   * so no rules runtime reaches the stream.
   */
  where<TInputs extends Readonly<Record<string, unknown>>>(
    predicate: RulePredicate<TRow, TInputs>,
    ...inputs: keyof TInputs extends never ? readonly [] : readonly [inputs: TInputs]
  ): NdjsonParsePlan<TRow, TOutput>;
  select<const TKeys extends readonly Extract<keyof TRow, string>[]>(
    ...fields: TKeys
  ): NdjsonParsePlan<TRow, NdjsonPick<TRow, TKeys[number]>>;
  readonly to: {
    iterator(): (input: NdjsonInput) => IterableIterator<TOutput>;
    visitor(): (input: NdjsonInput, consume: (row: TOutput, index: number) => void) => number;
    ndjson(): (input: NdjsonInput) => string;
  };
}

export interface NdjsonStringifyPlan<TRow> {
  (value: readonly TRow[]): string;
  readonly to: {
    iterator(): (value: readonly TRow[]) => IterableIterator<string>;
  };
}

function parse<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): NdjsonParsePlan<ATS.TypeofSchema<TSchema>> {
  return createParsePlan(createNdjsonDescriptor(unwrapSchema(schema), "parse")) as never;
}

export function createParsePlan(descriptor: NdjsonDescriptor): NdjsonParsePlan<unknown> {
  const result = compileNdjsonParse(descriptor) as unknown as NdjsonParsePlan<unknown>;

  Object.defineProperties(result, {
    validate: { value: () => result },
    where: {
      value: (predicate: unknown, ruleInputs?: unknown) => {
        const lowered = lowerRulePredicate(predicate, ruleInputs, descriptor.bindingValues.length);

        if (lowered !== undefined) {
          return createParsePlan(
            lowered.condition === undefined
              ? descriptor
              : appendNdjsonFilter(descriptor, lowered.condition, lowered.bindings)
          );
        }

        const state = createConditionBuilder(descriptor.bindingValues.length);
        const condition = (predicate as (query: QueryConditionBuilder<unknown>) => QueryConditionNode)(state.builder);

        return createParsePlan(appendNdjsonFilter(descriptor, condition, state.bindings));
      },
    },
    select: { value: (...fields: string[]) => createParsePlan(selectNdjson(descriptor, fields)) },
    to: {
      value: Object.freeze({
        iterator: () => compileNdjsonParse(withNdjsonSink(descriptor, "iterator")),
        visitor: () => compileNdjsonParse(withNdjsonSink(descriptor, "visitor")),
        ndjson: () => compileNdjsonParse(withNdjsonSink(descriptor, "ndjson")),
      }),
    },
  });
  return result;
}

function stringify<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): NdjsonStringifyPlan<ATS.TypeofSchema<TSchema>> {
  const descriptor = createNdjsonDescriptor(unwrapSchema(schema), "stringify");
  const result = compileNdjsonStringify(descriptor) as unknown as NdjsonStringifyPlan<ATS.TypeofSchema<TSchema>>;

  Object.defineProperty(result, "to", {
    value: Object.freeze({
      iterator: () => compileNdjsonStringify(withNdjsonSink(descriptor, "iterator")),
    }),
  });
  return result;
}

export interface NdjsonNamespace {
  readonly parse: typeof parse;
  readonly stringify: typeof stringify;
}

export const ndjson: NdjsonNamespace = Object.freeze({ parse, stringify });

export type { NdjsonChunk, NdjsonInput } from "../compiler/ndjson.js";
