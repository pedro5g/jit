import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { emitScrub, type ScrubAction } from "./security/emit-scrub.js";

/**
 * A compiled sanitizing function: returns a copy of the value with every
 * `.sanitize()` string cleaned. Untouched subtrees keep their identity.
 *
 * @template T - The value type described by the schema.
 */
export type Sanitize<T = unknown> = (value: T) => T;

/** Removes script/style blocks including their content. */
export const SCRIPT_BLOCK_REGEX = /<(script|style)[^>]*>[\s\S]*?<\/\1\s*>/gi;
/** Strips every remaining HTML tag. */
export const HTML_TAG_REGEX = /<[^>]*>/g;
const LT_REGEX = /</g;
const GT_REGEX = />/g;

const SANITIZE_BINDINGS = ["__scriptBlocks", "__htmlTags", "__lt", "__gt"] as const;
const SANITIZE_VALUES = [SCRIPT_BLOCK_REGEX, HTML_TAG_REGEX, LT_REGEX, GT_REGEX] as const;

/**
 * The inline sanitize chain applied to one string expression: drop
 * script/style blocks, strip remaining tags, escape stray angle brackets.
 */
export function emitSanitizeChain(valueExpr: string): string {
  return `${valueExpr}.replace(__scriptBlocks, "").replace(__htmlTags, "").replace(__lt, "&lt;").replace(__gt, "&gt;")`;
}

/** Binding names/values the sanitize chain relies on. */
export const sanitizeChainBindings = {
  names: SANITIZE_BINDINGS,
  values: SANITIZE_VALUES,
} as const;

/**
 * Emits the JavaScript source of a compiled sanitizing function.
 *
 * @param schema - The schema whose `.sanitize()` strings drive the rewrite.
 * @returns The generated sanitizing source.
 */
export function emitSanitizeSource(schema: ATS.AnyTypeSchema): string {
  return emitScrub(schema, selectSanitize).source;
}

/**
 * Compiles an XSS-stripping function for user-provided text.
 *
 * Strings marked with `.sanitize()` are cleaned inline in one pass:
 * `<script>`/`<style>` blocks are removed with their content, remaining
 * HTML tags are stripped, and stray `<`/`>` are escaped to entities. Only
 * paths containing sanitized fields are rebuilt — everything else is reused
 * by reference. The same chain runs inside compiled `parse`/`safeParse`, so
 * validation and sanitization share a single pass there.
 *
 * @throws JITError with code `UNSUPPORTED_SCHEMA` when sanitized fields sit
 * inside an unsupported container.
 */
export function compileSanitize<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  options?: CompileCacheOptions
): Sanitize<ATS.TypeofSchema<TSchema>> {
  return getCompileCached(
    schema,
    "sanitize",
    () => {
      const emitted = emitScrub(schema, selectSanitize);

      const compiled = globalThis.Function(
        ...SANITIZE_BINDINGS,
        `return ${emitted.source.replace("function scrub", "function sanitize")};`
      )(...SANITIZE_VALUES) as Sanitize<ATS.TypeofSchema<TSchema>>;

      registerArtifact(compiled as object, {
        kind: "operation",
        schema,
        op: "sanitize",
      });
      return compiled;
    },
    options
  );
}

function selectSanitize(base: ATS.AnyTypeSchema & { readonly def: Record<string, unknown> }): ScrubAction | undefined {
  if (base.type !== TypeName.string) return undefined;

  const checks = (base.def.checks as readonly { readonly kind: string }[] | undefined) ?? [];

  if (!checks.some((check) => check.kind === "sanitize")) return undefined;

  return (value) => emitSanitizeChain(value);
}
