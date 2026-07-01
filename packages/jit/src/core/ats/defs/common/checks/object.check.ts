import type { Check } from "./check.js";

export type ObjectCheck = Check<"strict"> | Check<"passthrough"> | Check<"strip">;
