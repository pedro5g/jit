import type { QueryDistinctNode, QueryUniqueNode } from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import { resolveHints } from "../core/hints/index.js";
import { JITError } from "../errors/index.js";
import { resolveRowField, resolveRowObjectSchema, resolveScalarKeyKind } from "./row-keys.js";
import { emitPropertyAccess } from "./source/access.js";

export type DistinctNode = QueryUniqueNode | QueryDistinctNode;
export type DistinctStrategy = "set" | "compound-trie" | "structural-hash" | "adjacent";

export interface DistinctDescriptor {
  readonly fields: readonly string[];
  readonly valueKinds: readonly import("./row-keys.js").ScalarKeyKind[];
  readonly strategy: DistinctStrategy;
}

/** Resolves one physical deduplication strategy from semantics and collection facts. */
export function resolveDistinctDescriptor(schema: ATS.AnyTypeSchema, node: DistinctNode): DistinctDescriptor {
  const object = resolveRowObjectSchema(schema, "distinct");
  const fields = node.kind === "unique" ? [node.key] : [...node.fields];

  if (new Set(fields).size !== fields.length) {
    throw new JITError("INVALID_QUERY", "query distinct repeats a field");
  }
  const valueKinds = fields.map((field) =>
    resolveScalarKeyKind(resolveRowField(object, field, "distinct"), field, "distinct")
  );

  if (fields.length === 0)
    return Object.freeze({
      fields: Object.freeze(fields),
      valueKinds: Object.freeze(valueKinds),
      strategy: "structural-hash",
    });

  const ordered = resolveHints(schema).collection?.ordered;
  const adjacent = fields.length === 1 && ordered !== undefined && ordered.key === fields[0];

  return Object.freeze({
    fields: Object.freeze(fields),
    valueKinds: Object.freeze(valueKinds),
    strategy: adjacent ? "adjacent" : fields.length === 1 ? "set" : "compound-trie",
  });
}

/** Emits a hoisted accept function. It creates no key tuple/string per row. */
export function emitDistinctAcceptSource(descriptor: DistinctDescriptor): string {
  if (descriptor.strategy === "structural-hash") {
    return `function __distinctAccept(seen, item) {
  const hash = __distinctHash(item);
  const bucket = seen.get(hash);
  if (bucket === undefined) { seen.set(hash, [item]); return true; }
  for (let i = 0, len = bucket.length; i < len; i++) {
    if (__distinctEqual(bucket[i], item)) return false;
  }
  bucket[bucket.length] = item;
  return true;
}`;
  }

  if (descriptor.strategy === "adjacent") {
    const access = emitDistinctKey(descriptor, 0);
    return `function __distinctAccept(state, item) {
  const key = ${access};
  if (state.has && (state.value === key || (state.value !== state.value && key !== key))) return false;
  state.has = true;
  state.value = key;
  return true;
}`;
  }

  if (descriptor.strategy === "set") {
    const access = emitDistinctKey(descriptor, 0);
    return `function __distinctAccept(seen, item) {
  const key = ${access};
  if (seen.has(key)) return false;
  seen.set(key, true);
  return true;
}`;
  }

  const lines = ["function __distinctAccept(root, item) {", "  let map = root;"];
  descriptor.fields.forEach((_field, index) => {
    const key = `key${index}`;
    lines.push(`  const ${key} = ${emitDistinctKey(descriptor, index)};`);
    if (index === descriptor.fields.length - 1) {
      lines.push(`  if (map.has(${key})) return false;`, `  map.set(${key}, true);`);
    } else {
      const next = `next${index}`;
      lines.push(
        `  let ${next} = map.get(${key});`,
        `  if (${next} === undefined) { ${next} = new Map(); map.set(${key}, ${next}); }`,
        `  map = ${next};`
      );
    }
  });
  lines.push("  return true;", "}");
  return lines.join("\n");
}

function emitDistinctKey(descriptor: DistinctDescriptor, index: number): string {
  const access = emitPropertyAccess("item", descriptor.fields[index] as string);
  return descriptor.valueKinds[index] === "date" ? `(${access} == null ? ${access} : ${access}.getTime())` : access;
}

export function wrapDistinctSource(source: string, descriptor: DistinctDescriptor | undefined): string {
  if (!descriptor) return source;
  return `(function () {\n${emitDistinctAcceptSource(descriptor)}\nreturn (${source});\n})()`;
}
