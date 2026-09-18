import { type CqrsInput, type CqrsInputOptions, cqrsAuthorize, cqrsInput, cqrsParse } from "./cqrs.js";

/**
 * Public, deny-by-default query definition exposed to untrusted request input.
 *
 * @example
 * ```ts
 * const User = JIT.object({ id: JIT.number(), name: JIT.string() });
 * const request: JIT.ApiQuery<typeof User.schema> = { select: ["id"] };
 * ```
 */
export type ApiQuery<TSchema extends import("../core/ats/index.js").AnyTypeSchema> = CqrsInput<TSchema>;

/**
 * Allowlist and structural limits for one public query boundary.
 *
 * @example
 * ```ts
 * const options: JIT.ApiQueryOptions<typeof User.schema> = { limits: { maxDepth: 2 } };
 * const boundary = JIT.api.query(User, options);
 * const query = JIT.api.parse(boundary)({ select: ["id"] });
 * ```
 */
export type ApiQueryOptions<TSchema extends import("../core/ats/index.js").AnyTypeSchema> = CqrsInputOptions<TSchema>;

/**
 * Public query boundaries. Parsed requests lower to the shared query model;
 * trusted application queries remain under `JIT.cqrs.query`. `authorize`
 * intersects a boundary with one actor's access and returns the effective
 * request, still in the portable V1 shape.
 *
 * @example
 * ```ts
 * const User = JIT.object({ id: JIT.number(), name: JIT.string() });
 * const request = JIT.api.parse(User)({ select: ["id"] });
 * ```
 */
export const api = Object.freeze({
  query: cqrsInput,
  parse: cqrsParse,
  authorize: cqrsAuthorize,
});
