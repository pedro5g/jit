import type { StringSchema } from "../core/ats/index.js";
import type { Builder } from "../core/builder/index.js";
import type { Regexes } from "../shared/index.js";
import { string } from "./primitive/string.js";

/**
 * Factories for ISO-8601 strings.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Birthday = JIT.iso.date();
 * JIT.validate.is(Birthday)("1990-04-12"); // true
 * ```
 */
export interface IsoFactories {
  /** Strict calendar date in `YYYY-MM-DD` form. */
  date(message?: string): Builder<StringSchema>;
  /** ISO local time with configurable second/fraction precision. */
  time(options?: Regexes.TimeOptions, message?: string): Builder<StringSchema>;
  /** ISO date-time with optional local and numeric-offset support. */
  datetime(options?: Regexes.DatetimeOptions, message?: string): Builder<StringSchema>;
  /** ISO 8601-1 duration such as `P3Y6M4DT12H30M5S`. */
  duration(message?: string): Builder<StringSchema>;
}

/**
 * String-based ISO schemas grouped independently from native `Date` and the
 * Temporal proposal. Legacy `JIT.string().date/time/datetime/duration()`
 * chains delegate to the same checks and remain supported.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const StartedAt = JIT.iso.datetime();
 * JIT.validate.is(StartedAt)("2024-01-01T12:00:00Z"); // true
 * ```
 */
export const iso: IsoFactories = {
  date: (message) => string().date(message),
  time: (options, message) => string().time(options, message),
  datetime: (options, message) => string().datetime(options, message),
  duration: (message) => string().duration(message),
};
