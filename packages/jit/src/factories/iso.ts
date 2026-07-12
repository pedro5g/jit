import type { StringSchema } from "../core/ats/index.js";
import type { Builder } from "../core/builder/index.js";
import type { Regexes } from "../shared/index.js";
import { string } from "./primitive/string.js";

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
 */
export const iso: IsoFactories = {
  date: (message) => string().date(message),
  time: (options, message) => string().time(options, message),
  datetime: (options, message) => string().datetime(options, message),
  duration: (message) => string().duration(message),
};
