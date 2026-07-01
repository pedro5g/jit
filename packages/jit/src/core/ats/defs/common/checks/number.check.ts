import type { Check } from "./check.js";

export type NumberCheck =
  | Check<"min", number>
  | Check<"max", number>
  | Check<"positive">
  | Check<"negative">
  | Check<"multipleOf", number>
  | Check<"finite">
  | Check<"safe">
  | Check<"integer">;
