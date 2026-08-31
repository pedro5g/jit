/**
 * Checking an intent against the API that actually exists — §53 and §54.
 *
 * `parseSchemaIntent` proves the model produced the right *shape*. It says
 * nothing about whether `.notEmpty()` is a real string method, and it cannot:
 * the protocol carries method names as strings precisely so that this pass can
 * judge them against the symbol index rather than against a hard-coded list
 * that would drift away from the library within a release.
 *
 * The rule that makes this strict rather than decorative: a method the model
 * names must be recorded on *that kind*. `.email()` exists, and it exists on
 * strings; accepting it on a number because the name is real anywhere would
 * produce exactly the confident wrong answer the whole design exists to stop.
 */
import type { SchemaField, SchemaIntent } from "../../core/entities/schema-intent";
import { FACTORY_FOR_TYPE } from "../../core/entities/schema-intent";
import type { SymbolRepository } from "../../core/repositories";

export interface IntentFinding {
  /** Where it is, in the intent: `fields.email.validators[0]`. */
  path: string;
  message: string;
  /** The name the model wrote, when the finding is about one. */
  offender?: string;
  /** Real alternatives, when the index offers any. */
  suggestions?: string[];
}

/** A valid TypeScript identifier, which an unquoted key must be. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** What a quoted key may contain. Anything else is refused, not escaped. */
const QUOTABLE = /^[A-Za-z0-9_$ .\-@]+$/;

/**
 * The three the generator writes from structural flags rather than from a name
 * the model chose.
 *
 * They are checked for existence in the index, but not against the field's
 * kind: the symbol extractor records a chain method under the factory whose
 * page documents it, and the universal builder methods are documented under
 * some kinds and not others. A boolean genuinely accepts `.optional()`; the
 * index simply has no row saying so. The narrow exception is safe because the
 * model never names these — it sets `optional: true`, and code decides the
 * spelling.
 */
const STRUCTURAL = ["optional", "nullable", "default"] as const;

export interface VerifyOptions {
  symbols: SymbolRepository;
}

export function verifyIntent(intent: SchemaIntent, options: VerifyOptions): IntentFinding[] {
  const findings: IntentFinding[] = [];

  if (intent.name !== undefined && !IDENTIFIER.test(intent.name)) {
    findings.push({ path: "name", message: "not a valid TypeScript identifier", offender: intent.name });
  }

  for (const name of STRUCTURAL) {
    if (!hasMethodAnywhere(options.symbols, name)) {
      findings.push({ path: "(generator)", message: `jit has no .${name}() — the generator cannot emit this schema` });
    }
  }

  walk(intent.fields, "fields", options, findings);
  return findings;
}

function walk(fields: readonly SchemaField[], path: string, options: VerifyOptions, findings: IntentFinding[]): void {
  for (const field of fields) {
    const at = `${path}.${field.name}`;

    if (!IDENTIFIER.test(field.name) && !QUOTABLE.test(field.name)) {
      findings.push({ path: at, message: "field name is not writable as a key", offender: field.name });
    }

    // The factory itself has to exist. It always does today — the map is
    // hard-coded — but the check is what turns a future rename of a public
    // factory into a failing test rather than a generated file that throws.
    const factory = FACTORY_FOR_TYPE[field.type];
    if (!options.symbols.findByPath(factory)) {
      findings.push({ path: at, message: `${factory} is not in the API surface`, offender: factory });
    }

    verifyValidators(field, at, options, findings);

    if (field.type === "enum") {
      for (const [index, value] of (field.values ?? []).entries()) {
        if (value.trim() === "") findings.push({ path: `${at}.values[${index}]`, message: "an enum value is empty" });
      }
    }

    if (field.default?.type === "value" && field.default.value === null && !field.nullable) {
      findings.push({ path: `${at}.default`, message: "a null default needs nullable: true" });
    }

    if (field.fields) walk(field.fields, at, options, findings);
    if (field.items) walk([field.items], `${at}[]`, options, findings);
  }
}

function verifyValidators(field: SchemaField, at: string, options: VerifyOptions, findings: IntentFinding[]): void {
  const validators = field.validators ?? [];
  if (validators.length === 0) return;

  // Constraints only. A model that lists `.parse` as a validator is told to
  // stop rather than handed a schema that calls it mid-chain.
  const available = options.symbols.checksFor(field.type);
  const names = new Set(available.map((symbol) => symbol.name));

  for (const [index, validator] of validators.entries()) {
    const path = `${at}.validators[${index}]`;

    if (STRUCTURAL.includes(validator.type as (typeof STRUCTURAL)[number])) {
      findings.push({
        path,
        message: `set ${validator.type}: true on the field instead of listing it as a validator`,
        offender: validator.type,
      });
      continue;
    }

    if (!names.has(validator.type)) {
      findings.push({
        path,
        message:
          available.length === 0
            ? `jit records no constraints for ${field.type}, so it takes no validators`
            : `.${validator.type}() is not a ${field.type} method`,
        offender: validator.type,
        ...(available.length > 0 ? { suggestions: near(validator.type, [...names]) } : {}),
      });
      continue;
    }

    if (validator.value !== undefined && typeof validator.value === "number" && !Number.isFinite(validator.value)) {
      findings.push({ path, message: "argument is not a finite number", offender: validator.type });
    }

    // A date bound arrives as a string and is emitted as `new Date(...)`, so
    // an unparseable one would generate code that builds an Invalid Date.
    if (field.type === "date" && typeof validator.value === "string" && Number.isNaN(Date.parse(validator.value))) {
      findings.push({ path, message: `"${validator.value}" is not a date`, offender: validator.type });
    }
  }
}

function hasMethodAnywhere(symbols: SymbolRepository, name: string): boolean {
  return symbols.all().some((symbol) => symbol.kind === "method" && symbol.name === name);
}

/**
 * The closest real names, so a retry has somewhere to go.
 *
 * Edit distance rather than a prefix test, because the misses that matter are
 * one character out: a model writes `notEmpty` for `noEmpty` and `uuidv4` for
 * `uuid`, and a prefix rule matches neither. Naming the real method is most of
 * what makes the single retry (§58) land.
 */
function near(wrong: string, candidates: readonly string[]): string[] {
  const lower = wrong.toLowerCase();

  return candidates
    .map((name) => ({ name, distance: distance(lower, name.toLowerCase()) }))
    .filter((entry) => entry.distance <= Math.max(2, Math.floor(lower.length / 4)))
    .sort((left, right) => left.distance - right.distance || left.name.localeCompare(right.name))
    .slice(0, 4)
    .map((entry) => entry.name);
}

/** Levenshtein, one row at a time — the lists here are tens of names long. */
function distance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let i = 1; i <= left.length; i++) {
    const row = [i];
    for (let j = 1; j <= right.length; j++) {
      const substitution = (previous[j - 1] as number) + (left[i - 1] === right[j - 1] ? 0 : 1);
      row[j] = Math.min(substitution, (previous[j] as number) + 1, (row[j - 1] as number) + 1);
    }
    previous = row;
  }

  return previous[right.length] as number;
}
