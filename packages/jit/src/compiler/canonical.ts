import * as ATS from "../core/ats/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { expectProjectionObject } from "./projection.js";
import { resolveWrappers } from "./resolvers/resolve-wrappers.js";
import { emitPropertyAccess } from "./source/access.js";

type ObjectSchema = ATS.AnyTypeSchema & { readonly def: ATS.ObjectDef };

/**
 * One deterministic representation for values that are semantically the same.
 *
 * Two objects with identical fields in different insertion order are equal to a
 * reader and different to anything that walks keys — a serializer, a cache key
 * built by hand, a structural hash that trusts key order. Canonicalizing puts
 * the fields in the order the schema declares them.
 *
 * The generated function checks first and rebuilds only if it has to, so a
 * value that is already canonical comes back by reference with nothing
 * allocated. That check costs a `Object.keys` call, which is why it is a
 * measured tradeoff rather than a free one — see the feature doc.
 */
export function emitCanonicalSource(schema: ATS.AnyTypeSchema, name = "canonical"): string {
  const object = expectProjectionObject(schema, "JIT.canonical()");
  const nested = new Map<string, string>();
  const root = new CodeWriter();

  emitCanonicalFunction(root, object, name, nested);

  const helpers = [...nested.values()].filter((source) => source !== "");

  return `(function () {\n${helpers.join("\n")}\n${root.toString()}\nreturn ${name};\n})()`;
}

function emitCanonicalFunction(
  writer: CodeWriter,
  object: ObjectSchema,
  name: string,
  nested: Map<string, string>
): void {
  const keys = Object.keys(object.def.props);
  const children = new Map<string, string>();

  for (const key of keys) {
    const base = resolveWrappers(object.def.props[key] as ATS.AnyTypeSchema).base;

    if (base.type === ATS.TypeName.object) {
      children.set(key, childName(name, key, base as ObjectSchema, nested));
    }
  }

  writer.line(`function ${name}(value) {`);
  writer.indent(() => {
    writer.line('if (value === null || typeof value !== "object") return value;');

    // The order check is the whole optimization: an already-canonical value is
    // returned as it stands, with nothing allocated.
    writer.line("const keys = Object.keys(value);");
    const ordered = keys.map((key, index) => `keys[${index}] === ${JSON.stringify(key)}`).join(" && ");

    writer.line(`let canonical = keys.length === ${keys.length}${ordered === "" ? "" : ` && ${ordered}`};`);

    // A nested object may be out of order even when this level is not.
    for (const [key, child] of children) {
      const read = emitPropertyAccess("value", key);
      const local = `next_${key.replace(/[^A-Za-z0-9_$]/g, "_")}`;

      writer.line(`const ${local} = ${child}(${read});`);
      writer.line(`if (${local} !== ${read}) canonical = false;`);
    }

    writer.line("if (canonical) return value;");
    writer.line("return {");
    writer.indent(() => {
      for (const key of keys) {
        const child = children.get(key);
        const read = emitPropertyAccess("value", key);
        const local = `next_${key.replace(/[^A-Za-z0-9_$]/g, "_")}`;

        writer.line(`${JSON.stringify(key)}: ${child === undefined ? read : local},`);
      }
    });
    writer.line("};");
  });
  writer.line("}");
}

function childName(parent: string, key: string, schema: ObjectSchema, nested: Map<string, string>): string {
  const name = `${parent}_${key.replace(/[^A-Za-z0-9_$]/g, "_")}`;

  if (!nested.has(name)) {
    const writer = new CodeWriter();

    nested.set(name, "");
    emitCanonicalFunction(writer, schema, name, nested);
    nested.set(name, writer.toString());
  }
  return name;
}

export function compileCanonical<TValue>(
  schema: ATS.AnyTypeSchema,
  options?: CompileCacheOptions
): (value: TValue) => TValue {
  const template = getCompileCached(
    schema,
    "canonical",
    () => {
      const source = emitCanonicalSource(schema);
      return { source, create: globalThis.Function(`return ${source};`) };
    },
    options
  );
  const compiled = template.create() as (value: TValue) => TValue;

  registerArtifact(compiled as object, { kind: "canonical-plan", schema });
  return compiled;
}
