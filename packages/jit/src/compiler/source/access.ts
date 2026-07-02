import { Parse } from "../../shared/index.js";

export function emitPropertyAccess(base: string, key: string): string {
  return `${base}${Parse.key_access(key, false)}`;
}

export function emitIndexAccess(base: string, index: string): string {
  return `${base}[${index}]`;
}
