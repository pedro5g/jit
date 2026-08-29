import { type CqrsInput, type CqrsInputOptions, cqrsAuthorize, cqrsInput, cqrsParse } from "./cqrs.js";

/** Public, deny-by-default query definition exposed to untrusted request input. */
export type ApiQuery<TSchema extends import("../core/ats/index.js").AnyTypeSchema> = CqrsInput<TSchema>;

/** Allowlist and structural limits for one public query boundary. */
export type ApiQueryOptions<TSchema extends import("../core/ats/index.js").AnyTypeSchema> = CqrsInputOptions<TSchema>;

/**
 * Public query boundaries. Parsed requests lower to the shared query model;
 * trusted application queries remain under `JIT.cqrs.query`. `authorize`
 * intersects a boundary with one actor's access and returns the effective
 * request, still in the portable V1 shape.
 */
export const api = Object.freeze({
  query: cqrsInput,
  parse: cqrsParse,
  authorize: cqrsAuthorize,
});
