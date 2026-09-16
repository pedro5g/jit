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

/** Provides the JIT csv schema options operation for the supplied input. */
export type CsvSchemaOptions<TRow> = Omit<CsvOptions, "columns"> & {
  readonly columns?: Partial<Record<keyof TRow, string>>;
};

/** Provides the JIT csv parse plan operation for the supplied input. */
export interface CsvParsePlan<TRow> {
  (input: CsvInput): TRow[];
  readonly to: {
    iterator(): (input: CsvInput) => IterableIterator<TRow>;
    visitor(): (input: CsvInput, consume: (row: TRow, index: number) => void) => number;
  };
}

/** Provides the JIT csv stringify plan operation for the supplied input. */
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

/** Describes the JIT csv namespace contract used by the public API. */
export interface CsvNamespace {
  readonly parse: typeof parse;
  readonly stringify: typeof stringify;
}

/** RFC 4180 transport plans compiled from an object row schema. */
export const csv: CsvNamespace = Object.freeze({ parse, stringify });

/** Provides the JIT type operation for the supplied input. */
export type { CsvChunk, CsvInput };
