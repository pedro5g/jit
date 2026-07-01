import type { Check } from "./check.js";

export type ArrayCheck =
  | Check<"min", number>
  | Check<"max", number>
  | Check<"length", number>
  | Check<"nonEmpty">
  | Check<"unique">;
