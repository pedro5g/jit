import * as ATS from "../core/ats/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { expectProjectionObject } from "./projection.js";
import { resolveWrappers } from "./resolvers/resolve-wrappers.js";
import { emitPropertyAccess } from "./source/access.js";

type ObjectSchema = ATS.AnyTypeSchema & { readonly def: ATS.ObjectDef };

/**
 * A JSON Merge Patch (RFC 7396), specialized to a schema.
 *
 * The generic algorithm walks the patch with `Object.keys` and recurses on
 * whatever it finds. The schema already says which members exist and which of
 * them are objects worth recursing into, so the walk becomes a fixed sequence
 * of static-key checks and the recursion becomes a direct call.
 */
function emitMergeFunction(writer: CodeWriter, object: ObjectSchema, name: string, nested: Map<string, string>): void {
  const props = object.def.props;

  writer.line(`function ${name}(value, patch) {`);
  writer.indent(() => {
    // RFC 7396: a patch that is not an object replaces the target outright.
    writer.line('if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return patch;');
    writer.line("let changed = false;");
    writer.line("const out = {};");

    for (const key of Object.keys(props)) {
      const field = props[key] as ATS.AnyTypeSchema;
      const read = emitPropertyAccess("value", key);
      const patched = emitPropertyAccess("patch", key);
      const inPatch = `${JSON.stringify(key)} in patch`;
      const base = resolveWrappers(field).base;
      const child = base.type === ATS.TypeName.object ? childName(name, key, base as ObjectSchema, nested) : undefined;

      writer.line(`if (${inPatch}) {`);
      writer.indent(() => {
        // A null member removes it, which is the one place merge patch and a
        // plain assignment disagree.
        writer.line(`if (${patched} === null) {`);
        writer.indent(() => writer.line("changed = true;"));
        writer.line("} else {");
        writer.indent(() => {
          if (child === undefined) {
            writer.line(`out[${JSON.stringify(key)}] = ${patched};`);
            writer.line(`if (!Object.is(${read}, ${patched})) changed = true;`);
          } else {
            writer.line(`const merged = ${child}(${read}, ${patched});`);
            writer.line(`out[${JSON.stringify(key)}] = merged;`);
            writer.line(`if (!Object.is(${read}, merged)) changed = true;`);
          }
        });
        writer.line("}");
      });
      writer.line(`} else if (${JSON.stringify(key)} in value) {`);
      writer.indent(() => writer.line(`out[${JSON.stringify(key)}] = ${read};`));
      writer.line("}");
    }

    // Unchanged means the original value, so callers can compare by reference.
    writer.line("return changed ? out : value;");
  });
  writer.line("}");
}

function childName(parent: string, key: string, schema: ObjectSchema, nested: Map<string, string>): string {
  const name = `${parent}_${key.replace(/[^A-Za-z0-9_$]/g, "_")}`;

  if (!nested.has(name)) {
    const writer = new CodeWriter();

    nested.set(name, "");
    emitMergeFunction(writer, schema, name, nested);
    nested.set(name, writer.toString());
  }
  return name;
}

/** The merge patch plus every nested helper it calls, as one expression. */
export function emitMergePatchProgram(schema: ATS.AnyTypeSchema): string {
  const object = expectProjectionObject(schema, "JIT.patch.merge()");
  const nested = new Map<string, string>();
  const root = new CodeWriter();

  emitMergeFunction(root, object, "mergePatch", nested);

  const helpers = [...nested.values()].filter((source) => source !== "");

  return `(function () {\n${helpers.join("\n")}\n${root.toString()}\nreturn mergePatch;\n})()`;
}

export function compileMergePatch<TValue>(
  schema: ATS.AnyTypeSchema,
  options?: CompileCacheOptions
): (value: TValue, patch: unknown) => TValue {
  const template = getCompileCached(
    schema,
    "patch:merge",
    () => {
      const source = emitMergePatchProgram(schema);
      return { source, create: globalThis.Function(`return ${source};`) };
    },
    options
  );
  const compiled = template.create() as (value: TValue, patch: unknown) => TValue;

  registerArtifact(compiled as object, { kind: "patch-plan", schema, mode: "merge" });
  return compiled;
}

// --------------------------------------------------------------- RFC 6902

/**
 * A JSON Patch (RFC 6902) applied to a schema-shaped value.
 *
 * Unlike the rest of this compiler, there is little here to specialize: a
 * pointer is a string that arrives with the patch, so it has to be parsed and
 * walked at run time. This exists for interoperability and for AOT — the
 * generated module carries the whole implementation with no JIT dependency —
 * not because compiling it makes it faster. The schema's contribution is that
 * the target shape is known to be an object, and that the result is immutable
 * and shares unchanged substructure.
 */
export function emitJsonPatchSource(schema: ATS.AnyTypeSchema): string {
  // The target must be an object for a pointer to reach into it.
  expectProjectionObject(schema, "JIT.patch.json()");

  const writer = new CodeWriter();

  writer.line("function applyPatch(value, operations) {");
  writer.indent(() => {
    writer.line("let out = value;");
    writer.line("for (let i = 0, len = operations.length; i < len; i++) {");
    writer.indent(() => {
      writer.line("const operation = operations[i];");
      writer.line("const path = __parsePointer(operation.path);");
      writer.line("switch (operation.op) {");
      writer.indent(() => {
        writer.line('case "add": out = __set(out, path, operation.value, true); break;');
        writer.line('case "replace": out = __set(out, path, operation.value, false); break;');
        writer.line('case "remove": out = __remove(out, path); break;');
        writer.line('case "move": {');
        writer.indent(() => {
          writer.line("const from = __parsePointer(operation.from);");
          writer.line("const moved = __get(out, from);");
          writer.line("out = __set(__remove(out, from), path, moved, true);");
          writer.line("break;");
        });
        writer.line("}");
        writer.line('case "copy": {');
        writer.indent(() => {
          writer.line("const from = __parsePointer(operation.from);");
          writer.line("out = __set(out, path, __get(out, from), true);");
          writer.line("break;");
        });
        writer.line("}");
        writer.line('case "test": {');
        writer.indent(() => {
          writer.line("if (!__patchEqual(__get(out, path), operation.value)) {");
          writer.indent(() => writer.line('throw new Error("json patch test failed at " + operation.path);'));
          writer.line("}");
          writer.line("break;");
        });
        writer.line("}");
        writer.line('default: throw new Error("unsupported json patch op: " + operation.op);');
      });
      writer.line("}");
    });
    writer.line("}");
    writer.line("return out;");
  });
  writer.line("}");
  return writer.toString();
}

/**
 * The pointer helpers.
 *
 * They are emitted once per module rather than per operation, and they are the
 * only part of a JSON Patch that has to be dynamic — a pointer is a string that
 * arrives at run time.
 */
export const JSON_PATCH_HELPERS = `function __parsePointer(pointer) {
  if (pointer === "") return [];
  if (pointer.charCodeAt(0) !== 47) throw new Error("json pointer must start with /: " + pointer);
  const raw = pointer.slice(1).split("/");
  const out = new Array(raw.length);
  for (let i = 0, len = raw.length; i < len; i++) {
    const segment = raw[i];
    out[i] = segment.indexOf("~") === -1 ? segment : segment.replace(/~1/g, "/").replace(/~0/g, "~");
  }
  return out;
}
function __get(value, path) {
  let current = value;
  for (let i = 0, len = path.length; i < len; i++) {
    if (current === null || current === undefined) throw new Error("json pointer does not resolve");
    current = current[path[i]];
  }
  return current;
}
function __copy(value, segment) {
  if (Array.isArray(value)) return value.slice();
  return { ...value };
}
function __set(value, path, next, isAdd) {
  if (path.length === 0) return next;
  const key = path[0];
  const out = __copy(value, key);
  if (path.length === 1) {
    if (Array.isArray(out)) {
      const index = key === "-" ? out.length : Number(key);
      if (isAdd) out.splice(index, 0, next);
      else out[index] = next;
    } else {
      out[key] = next;
    }
    return out;
  }
  out[key] = __set(value[key], path.slice(1), next, isAdd);
  return out;
}
function __remove(value, path) {
  if (path.length === 0) return undefined;
  const key = path[0];
  const out = __copy(value, key);
  if (path.length === 1) {
    if (Array.isArray(out)) out.splice(Number(key), 1);
    else delete out[key];
    return out;
  }
  out[key] = __remove(value[key], path.slice(1));
  return out;
}`;

/**
 * The `test` comparison, as a module helper.
 *
 * A pointer may name any subtree, including one the schema does not describe,
 * so this comparison assumes no shape. It is the one part of the operation that
 * genuinely cannot be specialized.
 */
export const PATCH_EQUAL_HELPER = `function __patchEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
  const leftIsArray = Array.isArray(left);
  if (leftIsArray !== Array.isArray(right)) return false;
  if (leftIsArray) {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) if (!__patchEqual(left[i], right[i])) return false;
    return true;
  }
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (let i = 0; i < keys.length; i++) {
    if (!__patchEqual(left[keys[i]], right[keys[i]])) return false;
  }
  return true;
}`;

export function compileJsonPatch<TValue>(
  schema: ATS.AnyTypeSchema,
  options?: CompileCacheOptions
): (value: TValue, operations: readonly unknown[]) => TValue {
  const template = getCompileCached(
    schema,
    "patch:json",
    () => {
      const source = emitJsonPatchSource(schema);
      return {
        source,
        create: globalThis.Function("__patchEqual", `${JSON_PATCH_HELPERS}\nreturn ${source};`),
      };
    },
    options
  );
  // `test` may name any subtree, including one the schema does not describe, so
  // it needs a comparison that assumes no shape.
  const compiled = template.create(deepEqual) as (value: TValue, operations: readonly unknown[]) => TValue;

  registerArtifact(compiled as object, { kind: "patch-plan", schema, mode: "json" });
  return compiled;
}

/** Structural comparison for `test`, which may point at any subtree. */
function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) if (!deepEqual(left[i], right[i])) return false;
    return true;
  }

  const leftKeys = Object.keys(left as object);

  if (leftKeys.length !== Object.keys(right as object).length) return false;
  for (const key of leftKeys) {
    if (!deepEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key])) return false;
  }
  return true;
}
