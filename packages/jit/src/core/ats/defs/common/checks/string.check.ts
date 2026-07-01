import type { Check } from "./check.js";

export type StringCheck =
  | Check<"min", number>
  | Check<"max", number>
  | Check<"length", number>
  | Check<"regex", RegExp>
  | Check<"email">
  | Check<"uuid">
  | Check<"url">
  | Check<"trim">
  | Check<"lowercase">
  | Check<"uppercase">;
