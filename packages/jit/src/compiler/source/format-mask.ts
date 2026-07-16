import { emitLiteral } from "./literal.js";

export function countFormatPlaceholders(pattern: string): number {
  let count = 0;

  for (let index = 0; index < pattern.length; index++) {
    if (pattern.charCodeAt(index) === 35) count++;
  }
  return count;
}

export function emitFormatMaskExpression(value: string, pattern: string): string {
  const parts: string[] = [];
  let cursor = 0;

  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];

    parts.push(character === "#" ? `${value}[${cursor++}]` : emitLiteral(character));
  }
  return parts.length === 0 ? '""' : parts.join(" + ");
}

export function emitStrictFormatCondition(value: string, pattern: string): string {
  const checks = [`${value}.length !== ${pattern.length}`];

  for (let index = 0; index < pattern.length; index++) {
    const code = pattern.charCodeAt(index);

    checks.push(
      code === 35
        ? `(${value}.charCodeAt(${index}) < 48 || ${value}.charCodeAt(${index}) > 57)`
        : `${value}.charCodeAt(${index}) !== ${code}`
    );
  }
  return checks.join(" || ");
}
