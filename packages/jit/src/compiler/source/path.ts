import { Parse } from "../../shared/index.js";

export function emitPath(root: string, path: readonly string[]): string {
  let out = root;

  for (const key of path) out += Parse.key_access(key, false);

  return out;
}
