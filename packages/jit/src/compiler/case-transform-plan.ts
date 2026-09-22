/** Canonical styles shared by string case validation, transforms, and naming. */
export type CaseStyle = "lower" | "upper" | "camel" | "pascal" | "snake" | "kebab" | "upper-snake";

/** Whether a case operator checks its input or rewrites its parsed output. */
export type CaseOperation = "validate" | "transform";

/** The semantic lowering for one public case operator. */
export interface CaseTransformPlan {
  readonly kind: string;
  readonly operation: CaseOperation;
  readonly style: CaseStyle;
}

const CASE_PLANS: Readonly<Record<string, CaseTransformPlan>> = {
  lowercase: { kind: "lowercase", operation: "validate", style: "lower" },
  uppercase: { kind: "uppercase", operation: "validate", style: "upper" },
  camelCase: { kind: "camelCase", operation: "validate", style: "camel" },
  pascalCase: { kind: "pascalCase", operation: "validate", style: "pascal" },
  snakeCase: { kind: "snakeCase", operation: "validate", style: "snake" },
  kebabCase: { kind: "kebabCase", operation: "validate", style: "kebab" },
  upperSnakeCase: { kind: "upperSnakeCase", operation: "validate", style: "upper-snake" },
  toLowerCase: { kind: "toLowerCase", operation: "transform", style: "lower" },
  toUpperCase: { kind: "toUpperCase", operation: "transform", style: "upper" },
  toCamelCase: { kind: "toCamelCase", operation: "transform", style: "camel" },
  toPascalCase: { kind: "toPascalCase", operation: "transform", style: "pascal" },
  toSnakeCase: { kind: "toSnakeCase", operation: "transform", style: "snake" },
  toKebabCase: { kind: "toKebabCase", operation: "transform", style: "kebab" },
  toUpperSnakeCase: { kind: "toUpperSnakeCase", operation: "transform", style: "upper-snake" },
};

/** Source helper used only by generated validators that need a compound case. */
export const CASE_RUNTIME_SOURCE = `function __caseTransform(value, style) {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  if (style === "lower") return value.toLowerCase();
  if (style === "upper") return value.toUpperCase();
  if (style === "camel") return words.length === 0 ? "" : words[0] + words.slice(1).map(__capitalizeCaseWord).join("");
  if (style === "pascal") return words.map(__capitalizeCaseWord).join("");
  if (style === "snake") return words.join("_");
  if (style === "kebab") return words.join("-");
  return words.join("_").toUpperCase();
}
function __capitalizeCaseWord(word) {
  return word.length === 0 ? word : word[0].toUpperCase() + word.slice(1);
}`;

/** TypeScript-annotated equivalent used only in standalone `.ts` artifacts. */
export const CASE_RUNTIME_TYPESCRIPT_SOURCE = `function __caseTransform(value: __JitValue, style: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word: string) => word.toLowerCase());
  if (style === "lower") return value.toLowerCase();
  if (style === "upper") return value.toUpperCase();
  if (style === "camel") return words.length === 0 ? "" : words[0] + words.slice(1).map(__capitalizeCaseWord).join("");
  if (style === "pascal") return words.map(__capitalizeCaseWord).join("");
  if (style === "snake") return words.join("_");
  if (style === "kebab") return words.join("-");
  return words.join("_").toUpperCase();
}
function __capitalizeCaseWord(word: string): string {
  return word.length === 0 ? word : word[0].toUpperCase() + word.slice(1);
}`;

/** Returns the semantic plan for a schema check kind, if it is a case operator. */
export function caseTransformPlan(kind: string): CaseTransformPlan | undefined {
  return CASE_PLANS[kind];
}

/** Tokenizes ASCII identifier and separator boundaries for deterministic case conversion. */
export function tokenizeCase(value: string): readonly string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

/** Applies one case style without depending on the compiler or runtime registry. */
export function transformCase(value: string, style: CaseStyle): string {
  if (style === "lower") return value.toLowerCase();
  if (style === "upper") return value.toUpperCase();

  const words = tokenizeCase(value);
  if (style === "camel") return words.length === 0 ? "" : words[0] + words.slice(1).map(capitalizeCaseWord).join("");
  if (style === "pascal") return words.map(capitalizeCaseWord).join("");
  if (style === "snake") return words.join("_");
  if (style === "kebab") return words.join("-");
  return words.join("_").toUpperCase();
}

/** Tests canonical spelling without changing the caller's value. */
export function matchesCase(value: string, style: CaseStyle): boolean {
  return transformCase(value, style) === value;
}

/** Returns the portable JSON Schema approximation for a canonical case style. */
export function casePattern(style: CaseStyle): string {
  switch (style) {
    case "lower":
      return "^[^A-Z]*$";
    case "upper":
      return "^[^a-z]*$";
    case "camel":
      return "^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)*$";
    case "pascal":
      return "^[A-Z][a-z0-9]*(?:[A-Z][a-z0-9]*)*$";
    case "snake":
      return "^[a-z0-9]+(?:_[a-z0-9]+)*$";
    case "kebab":
      return "^[a-z0-9]+(?:-[a-z0-9]+)*$";
    case "upper-snake":
      return "^[A-Z0-9]+(?:_[A-Z0-9]+)*$";
  }
}

/** Returns a source expression for a specialized case operation. */
export function emitCaseExpression(value: string, style: CaseStyle): string {
  if (style === "lower") return `${value}.toLowerCase()`;
  if (style === "upper") return `${value}.toUpperCase()`;
  return `__caseTransform(${value}, ${JSON.stringify(style)})`;
}

function capitalizeCaseWord(word: string): string {
  return word.length === 0 ? word : `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`;
}
