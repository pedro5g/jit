import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { emitScrub, type ScrubAction } from "./security/emit-scrub.js";
import { emitLiteral } from "./source/literal.js";

/** A compiled schema-aware string cleaner with structural sharing. */
export type Sanitize<T = unknown> = (value: T) => T;

export const SCRIPT_BLOCK_REGEX = /<(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\/\1\s*>/gi;
export const HTML_TAG_REGEX = /<[^>]*>/g;
export const HTML_TAG_PARTS_REGEX = /<\s*(\/?)\s*([A-Za-z][A-Za-z0-9-]*)(?:\s[^>]*)?>/g;
const AMP_REGEX = /&/g;
const LT_REGEX = /</g;
const GT_REGEX = />/g;
const QUOTE_REGEX = /"/g;
const APOSTROPHE_REGEX = /'/g;
// biome-ignore lint/complexity/useRegexLiterals: constructor avoids literal control-character diagnostics.
const CONTROL_REGEX: RegExp = new RegExp("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]", "g");
const SQL_IDENTIFIER_REGEX = /^[^A-Za-z_$]+|[^A-Za-z0-9_$]+/g;
const PATH_TRAVERSAL_REGEX = /\.\.+/g;
const PATH_SEGMENT_REGEX = /[\\/:*?"<>|]/g;

const SANITIZE_BINDINGS = [
  "__scriptBlocks",
  "__htmlTags",
  "__htmlTagParts",
  "__amp",
  "__lt",
  "__gt",
  "__quote",
  "__apostrophe",
  "__controls",
  "__sqlIdentifier",
  "__pathTraversal",
  "__pathSegment",
] as const;
const SANITIZE_VALUES = [
  SCRIPT_BLOCK_REGEX,
  HTML_TAG_REGEX,
  HTML_TAG_PARTS_REGEX,
  AMP_REGEX,
  LT_REGEX,
  GT_REGEX,
  QUOTE_REGEX,
  APOSTROPHE_REGEX,
  CONTROL_REGEX,
  SQL_IDENTIFIER_REGEX,
  PATH_TRAVERSAL_REGEX,
  PATH_SEGMENT_REGEX,
] as const;

export const sanitizeChainBindings = {
  names: SANITIZE_BINDINGS,
  values: SANITIZE_VALUES,
} as const;

interface ResolvedSanitizeSpec {
  readonly html: ATS.StringSanitizeHtmlPolicy | undefined;
  readonly controls: "remove" | "space" | undefined;
  readonly normalize: ATS.StringNormalizationForm | undefined;
  readonly trim: boolean;
  readonly maxLength: number | undefined;
  readonly patterns: readonly ATS.StringSanitizePattern[];
  readonly sqlIdentifier: boolean;
  readonly pathSegment: boolean;
}

type BindRegex = (pattern: RegExp) => string;

/** Emits only the transformations selected by one `.sanitize()` policy. */
export function emitSanitizeChain(
  valueExpr: string,
  spec: ATS.StringSanitizeSpec = { preset: "text" },
  bindRegex?: BindRegex
): string {
  const resolved = resolveSanitizeSpec(spec);
  const regex = (pattern: RegExp): string => bindRegex?.(pattern) ?? staticRegexReference(pattern);
  let output = valueExpr;

  if (resolved.normalize) output = `${output}.normalize(${emitLiteral(resolved.normalize)})`;

  if (resolved.html === "strip") {
    output = `${output}.replace(${regex(SCRIPT_BLOCK_REGEX)}, "").replace(${regex(HTML_TAG_REGEX)}, "").replace(${regex(LT_REGEX)}, "&lt;").replace(${regex(GT_REGEX)}, "&gt;")`;
  } else if (resolved.html === "escape") {
    output = `${output}.replace(${regex(AMP_REGEX)}, "&amp;").replace(${regex(LT_REGEX)}, "&lt;").replace(${regex(GT_REGEX)}, "&gt;").replace(${regex(QUOTE_REGEX)}, "&quot;").replace(${regex(APOSTROPHE_REGEX)}, "&#39;")`;
  } else if (typeof resolved.html === "object") {
    const conditions = resolved.html.tags.map((tag) => `name === ${emitLiteral(tag)}`).join(" || ") || "false";

    output = `${output}.replace(${regex(SCRIPT_BLOCK_REGEX)}, "").replace(${regex(HTML_TAG_PARTS_REGEX)}, (_tag, slash, rawName) => { const name = rawName.toLowerCase(); return ${conditions} ? "<" + slash + name + ">" : ""; })`;
  }

  if (resolved.controls) {
    output = `${output}.replace(${regex(CONTROL_REGEX)}, ${emitLiteral(resolved.controls === "space" ? " " : "")})`;
  }
  if (resolved.sqlIdentifier) output = `${output}.replace(${regex(SQL_IDENTIFIER_REGEX)}, "_")`;
  if (resolved.pathSegment) {
    output = `${output}.replace(${regex(PATH_TRAVERSAL_REGEX)}, "_").replace(${regex(PATH_SEGMENT_REGEX)}, "_")`;
  }

  for (const rule of resolved.patterns) {
    output = `${output}.replace(${regex(rule.pattern)}, ${emitLiteral(rule.replacement ?? "")})`;
  }

  if (resolved.trim) output = `${output}.trim()`;
  if (resolved.maxLength !== undefined) output = `${output}.slice(0, ${resolved.maxLength})`;

  return output;
}

export function emitSanitizeSource(schema: ATS.AnyTypeSchema): string {
  return emitScrub(schema, selectSanitize).source;
}

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

  const checks =
    (base.def.checks as
      | readonly {
          readonly kind: string;
          readonly value?: ATS.StringSanitizeSpec;
        }[]
      | undefined) ?? [];
  const sanitizeChecks = checks.filter((check) => check.kind === "sanitize");

  if (sanitizeChecks.length === 0) return undefined;

  let probe = "value";

  for (const check of sanitizeChecks) probe = emitSanitizeChain(probe, check.value);
  if (probe === "value") return undefined;

  return (value) => {
    let output = value;

    for (const check of sanitizeChecks) output = emitSanitizeChain(output, check.value);
    return output;
  };
}

function resolveSanitizeSpec(spec: ATS.StringSanitizeSpec): ResolvedSanitizeSpec {
  const presets = Array.isArray(spec.preset) ? spec.preset : [spec.preset ?? "text"];
  let html: ATS.StringSanitizeHtmlPolicy | undefined;
  let controls: "remove" | "space" | undefined;
  let sqlIdentifier = false;
  let pathSegment = false;

  for (const preset of presets) {
    if (preset === "text") html = "strip";
    else if (preset === "htmlEscape") html = "escape";
    else if (preset === "sqlIdentifier") {
      controls = "remove";
      sqlIdentifier = true;
    } else if (preset === "pathSegment") {
      controls = "remove";
      pathSegment = true;
    }
  }

  if (spec.html !== undefined) html = spec.html;
  if (spec.controls !== undefined) controls = spec.controls === "preserve" ? undefined : spec.controls;

  return {
    html,
    controls,
    normalize: spec.normalize,
    trim: spec.trim === true,
    maxLength: spec.maxLength,
    patterns: spec.patterns ?? [],
    sqlIdentifier,
    pathSegment,
  };
}

function staticRegexReference(pattern: RegExp): string {
  const index = SANITIZE_VALUES.indexOf(pattern as (typeof SANITIZE_VALUES)[number]);

  return index === -1 ? String(pattern) : SANITIZE_BINDINGS[index];
}
