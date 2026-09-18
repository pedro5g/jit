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

/**
 * Options for column names and RFC 4180 CSV parsing.
 *
 * @example
 * ```ts
 * const options: CsvSchemaOptions<User> = { columns: { id: "user_id" } };
 * const parse = JIT.csv.parse(UserSchema, options);
 * ```
 */
export type CsvSchemaOptions<TRow> = Omit<CsvOptions, "columns"> & {
  readonly columns?: Partial<Record<keyof TRow, string>>;
};

/**
 * A compiled CSV parser with eager, iterator and visitor sinks.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Row = JIT.object({ id: JIT.int(), name: JIT.string() });
 * const parse = JIT.csv.parse(Row);
 * parse("id,name\n1,Ada\n"); // [{ id: 1, name: "Ada" }]
 * ```
 */
export interface CsvParsePlan<TRow> {
  /** Parses CSV input into rows. */
  (input: CsvInput): TRow[];
  readonly to: {
    /** Parses CSV input as a lazy row iterator. */
    iterator(): (input: CsvInput) => IterableIterator<TRow>;
    /** Parses rows into a visitor callback without creating a result array. */
    visitor(): (input: CsvInput, consume: (row: TRow, index: number) => void) => number;
  };
}

/**
 * A compiled CSV serializer with eager and iterator sinks.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Row = JIT.object({ id: JIT.int(), name: JIT.string() });
 * const stringify = JIT.csv.stringify(Row);
 * stringify([{ id: 1, name: "Ada" }]); // "id,name\n1,Ada\n"
 * ```
 */
export interface CsvStringifyPlan<TRow> {
  /** Serializes rows to CSV text. */
  (value: readonly TRow[]): string;
  readonly to: {
    /** Serializes rows as lazy CSV chunks. */
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

/**
 * The CSV parse and stringify factories exposed by `JIT.csv`.
 *
 * @example
 * ```ts
 * const rows = JIT.csv.parse(RowSchema)("id,name\n1,Ada\n");
 * ```
 */
export interface CsvNamespace {
  readonly parse: typeof parse;
  readonly stringify: typeof stringify;
}

/**
 * RFC 4180 transport plans compiled from an object row schema.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Row = JIT.object({ id: JIT.int(), name: JIT.string() });
 * const csv = JIT.csv.stringify(Row);
 * csv([{ id: 1, name: "Ada" }]);
 * ```
 */
export const csv: CsvNamespace = Object.freeze({ parse, stringify });

/** Provides the JIT type operation for the supplied input. */
export type { CsvChunk, CsvInput };
