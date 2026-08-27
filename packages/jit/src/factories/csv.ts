import {
  type CsvChunk,
  type CsvInput,
  type CsvOptions,
  compileCsvParse,
  compileCsvStringify,
  resolveCsvDescriptor,
} from "../compiler/csv.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";

export type CsvSchemaOptions<TRow> = Omit<CsvOptions, "columns"> & {
  readonly columns?: Partial<Record<keyof TRow, string>>;
};

export interface CsvParsePlan<TRow> {
  (input: CsvInput): TRow[];
  readonly to: {
    iterator(): (input: CsvInput) => IterableIterator<TRow>;
    visitor(): (input: CsvInput, consume: (row: TRow, index: number) => void) => number;
  };
}

export interface CsvStringifyPlan<TRow> {
  (value: readonly TRow[]): string;
  readonly to: {
    iterator(): (value: readonly TRow[]) => IterableIterator<string>;
  };
}

function parse<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  options?: CsvSchemaOptions<ATS.TypeofSchema<TSchema>>
): CsvParsePlan<ATS.TypeofSchema<TSchema>> {
  const unwrapped = unwrapSchema(schema);
  const result = compileCsvParse<ATS.TypeofSchema<TSchema>>(
    resolveCsvDescriptor(unwrapped, "parse", "result", options as CsvOptions)
  ) as CsvParsePlan<ATS.TypeofSchema<TSchema>>;

  Object.defineProperty(result, "to", {
    value: Object.freeze({
      iterator: () =>
        compileCsvParse<ATS.TypeofSchema<TSchema>>(
          resolveCsvDescriptor(unwrapped, "parse", "iterator", options as CsvOptions)
        ),
      visitor: () =>
        compileCsvParse<ATS.TypeofSchema<TSchema>>(
          resolveCsvDescriptor(unwrapped, "parse", "visitor", options as CsvOptions)
        ),
    }),
  });
  return result;
}

function stringify<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  options?: CsvSchemaOptions<ATS.TypeofSchema<TSchema>>
): CsvStringifyPlan<ATS.TypeofSchema<TSchema>> {
  const unwrapped = unwrapSchema(schema);
  const result = compileCsvStringify<ATS.TypeofSchema<TSchema>>(
    resolveCsvDescriptor(unwrapped, "stringify", "string", options as CsvOptions)
  ) as CsvStringifyPlan<ATS.TypeofSchema<TSchema>>;

  Object.defineProperty(result, "to", {
    value: Object.freeze({
      iterator: () =>
        compileCsvStringify<ATS.TypeofSchema<TSchema>>(
          resolveCsvDescriptor(unwrapped, "stringify", "iterator", options as CsvOptions)
        ),
    }),
  });
  return result;
}

export interface CsvNamespace {
  readonly parse: typeof parse;
  readonly stringify: typeof stringify;
}

/** RFC 4180 transport plans compiled from an object row schema. */
export const csv: CsvNamespace = Object.freeze({ parse, stringify });

export type { CsvChunk, CsvInput };
