/**
 * The prompt for structured generation, assembled from the index — §43.
 *
 * Nothing here lists an API name by hand. The menu of validators is read out
 * of the symbol repository at call time, which means a method added to jit
 * appears in the prompt on the next knowledge build, and a method removed
 * disappears from it — §111's question answered the only way that stays true.
 *
 * It is a JSON protocol rather than TypeScript because a 0.8B asked for code
 * writes plausible code containing one invented method, and asked for
 * `{ "type": "min", "value": 3 }` writes a value that either validates or does
 * not. The failure mode moves from "wrong answer that looks right" to "no
 * answer", and only one of those is recoverable.
 */

import { SCHEMA_FIELD_TYPES } from "../core/entities/schema-intent";
import type { SymbolRepository } from "../core/repositories";

/** Kinds whose constraints the index records, in the order they are shown. */
const MENU_KINDS = ["string", "number", "int", "date", "array"] as const;

/**
 * Every constraint a kind has, and no operations.
 *
 * Not truncated. The first version of this cut each list to the first twenty
 * names and the names are alphabetical, so `min`, `uuid` and `url` fell off
 * the end of the string list — the menu was missing exactly the validators
 * every request asks for. A complete list of real constraints is both shorter
 * and more useful than a truncated list of everything, which is what
 * `role: "check"` buys.
 */
export function validatorMenu(symbols: SymbolRepository): string {
  const lines: string[] = [];

  for (const kind of MENU_KINDS) {
    const names = [...new Set(symbols.checksFor(kind).map((symbol) => symbol.name))].sort();
    if (names.length > 0) lines.push(`${kind}: ${names.join(", ")}`);
  }

  lines.push("boolean, bigint, object, enum: no validators — the type is the constraint");
  return lines.join("\n");
}

export function schemaSystemPrompt(symbols: SymbolRepository): string {
  return `You describe a data shape as JSON. You never write TypeScript — code is generated from your JSON by a program that cannot make mistakes.

Reply with ONE JSON object and nothing else. No prose, no fence, no explanation.

{
  "kind": "object",
  "name": "User",
  "fields": [
    { "name": "id", "type": "string", "validators": [{ "type": "uuid" }], "default": { "type": "crypto.randomUUID" } },
    { "name": "email", "type": "string", "validators": [{ "type": "email" }] },
    { "name": "name", "type": "string", "validators": [{ "type": "min", "value": 3 }] },
    { "name": "age", "type": "int", "optional": true, "validators": [{ "type": "min", "value": 0 }] }
  ]
}

Rules:
1. "type" is one of: ${SCHEMA_FIELD_TYPES.join(", ")}.
2. A validator's "type" MUST come from the list below, for that field's type. If it is not listed, it does not exist — leave it out.
3. Optional, nullable and a default are fields on the field ("optional": true), never validators.
4. An object field needs "fields". An array field needs "items". An enum field needs "values".
5. Defaults are { "type": "value", "value": ... }, { "type": "crypto.randomUUID" } or { "type": "now" }.

Validators available:
${validatorMenu(symbols)}`;
}

export function schemaUserTurn(request: string): string {
  return `Describe this shape as the JSON object:\n\n${request}`;
}

/**
 * The retry, with the findings spelled out — §44 and §58.
 *
 * One attempt, and it names what was wrong rather than asking again politely.
 * A model told "that method does not exist on a string, these do" corrects
 * itself; a model told "try again" produces the same JSON.
 */
export function schemaRetryTurn(issues: readonly string[]): string {
  return `That JSON was rejected:

${issues.map((issue) => `- ${issue}`).join("\n")}

Send the corrected JSON object. Nothing else.`;
}
