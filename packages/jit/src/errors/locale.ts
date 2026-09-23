import type { IssueDescriptor } from "./validation-error.js";

/** Formats one structural validation issue for a presentation locale. */
export interface ErrorLocale {
  readonly format: (issue: IssueDescriptor) => string;
}

function numberParam(issue: IssueDescriptor, key: string): number | undefined {
  const value = issue.params?.[key];
  return typeof value === "number" ? value : undefined;
}

function formatEnglish(issue: IssueDescriptor): string {
  const minimum = numberParam(issue, "minimum");
  const maximum = numberParam(issue, "maximum");

  switch (issue.code) {
    case "expected_string":
      return "expected string";
    case "expected_number":
      return "expected number";
    case "expected_boolean":
      return "expected boolean";
    case "expected_object":
      return "expected object";
    case "expected_array":
      return "expected array";
    case "too_small":
      return minimum === undefined ? (issue.message ?? "value is too small") : `expected at least ${minimum}`;
    case "too_big":
      return maximum === undefined ? (issue.message ?? "value is too big") : `expected at most ${maximum}`;
    case "invalid_length":
      return issue.message ?? "invalid length";
    default:
      return issue.message ?? issue.code;
  }
}

function formatPortuguese(issue: IssueDescriptor): string {
  const minimum = numberParam(issue, "minimum");
  const maximum = numberParam(issue, "maximum");

  switch (issue.code) {
    case "expected_string":
      return "esperado texto";
    case "expected_number":
      return "esperado número";
    case "expected_boolean":
      return "esperado booleano";
    case "expected_object":
      return "esperado objeto";
    case "expected_array":
      return "esperado array";
    case "too_small":
      return minimum === undefined ? (issue.message ?? "valor muito pequeno") : `esperado no mínimo ${minimum}`;
    case "too_big":
      return maximum === undefined ? (issue.message ?? "valor muito grande") : `esperado no máximo ${maximum}`;
    default:
      return issue.message ?? issue.code;
  }
}

/** Built-in English presentation locale. */
export const enUS: ErrorLocale = Object.freeze({ format: formatEnglish });

/** Built-in Brazilian Portuguese presentation locale. */
export const ptBR: ErrorLocale = Object.freeze({ format: formatPortuguese });

/** Built-in locales exposed by the public JIT namespace. */
export const locales = Object.freeze({ enUS, ptBR });
