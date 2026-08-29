import { type CqrsInput, type CqrsInputOptions, cqrsInput, cqrsParse } from "./cqrs.js";

/** Public, deny-by-default query definition exposed to untrusted request input. */
export type ApiQuery<TSchema extends import("../core/ats/index.js").AnyTypeSchema> = CqrsInput<TSchema>;

/** Allowlist and structural limits for one public query boundary. */
export type ApiQueryOptions<TSchema extends import("../core/ats/index.js").AnyTypeSchema> = CqrsInputOptions<TSchema>;

/**
 * Public query boundaries. Parsed requests lower to the shared query model;
 * trusted application queries remain under `JIT.cqrs.query`.
 */
export const api = Object.freeze({
  query: cqrsInput,
  parse: cqrsParse,
});
