import type { RepeatSemantics } from "./contracts.js";

export function contractNotes(name: string, repeat: RepeatSemantics, terminal: boolean): string {
  if (name === "email")
    return "Email is a singleton validation stage; a second email stage requires an explicit replacement design.";
  if (name === "refine" || name === "assert")
    return "Independent predicates accumulate and preserve declaration order.";
  if (name === "validate")
    return "Validation fuses with a parse/decode stage and must not introduce a second validator.";
  if (terminal) return "Terminal operation returns or materializes the requested result and closes this chain.";
  return repeat === "forbid"
    ? "Singleton policy; repeat only through an explicit replacement contract."
    : "The operation composes with the current chain.";
}
