import type * as ATS from "../../core/ats/index.js";
import { TypeName } from "../../core/ats/index.js";
import { JITError } from "../../errors/index.js";
import { CodeWriter } from "../emitter/code-writer.js";
import { emitPropertyAccess } from "../source/access.js";

type AnySchema = ATS.AnyTypeSchema & { readonly def: Record<string, unknown> };

interface SerializeContext {
  readonly writer: CodeWriter;
  varCounter: number;
}

/**
 * Emits a shape-specialized `stringify(value)`: static JSON key prefixes are
 * baked into the source, only leaf values are read at runtime, and native
 * `JSON.stringify` is used solely for string escaping. Classic indexed
 * loops, no `Object.keys` on known shapes, no closures.
 */
export function emitSerialize(schema: ATS.AnyTypeSchema): string {
  const writer = new CodeWriter();
  const context: SerializeContext = { writer, varCounter: 0 };

  writer.line("function stringify(value) {");
  writer.indent(() => {
    writer.line('let s = "";');
    emitAppend(context, schema, "value");
    writer.line("return s;");
  });
  writer.line("}");

  return writer.toString();
}

function nextVar(context: SerializeContext, prefix: string): string {
  return `${prefix}${++context.varCounter}`;
}

/** Emits `s += ...` statements serializing `valueExpr` under `schema`. */
function emitAppend(context: SerializeContext, schema: ATS.AnyTypeSchema, valueExpr: string): void {
  const resolved = resolveSerializeWrappers(schema);
  const writer = context.writer;

  if (resolved.nullable || resolved.optional) {
    // JSON emits null for both; optional object PROPS are skipped earlier.
    writer.line(`if (${valueExpr} == null) {`);
    writer.indent(() => {
      writer.line('s += "null";');
    });
    writer.line("} else {");
    writer.indent(() => {
      emitBaseAppend(context, resolved.base, valueExpr);
    });
    writer.line("}");
    return;
  }

  emitBaseAppend(context, resolved.base, valueExpr);
}

function emitBaseAppend(context: SerializeContext, schema: AnySchema, valueExpr: string): void {
  const writer = context.writer;

  switch (schema.type) {
    case TypeName.string:
      writer.line(`s += JSON.stringify(${valueExpr});`);
      return;
    case TypeName.number:
    case TypeName.int:
    case TypeName.nan:
      writer.line(`s += Number.isFinite(${valueExpr}) ? "" + ${valueExpr} : "null";`);
      return;
    case TypeName.boolean:
      writer.line(`s += ${valueExpr} ? "true" : "false";`);
      return;
    case TypeName.null:
      writer.line('s += "null";');
      return;
    case TypeName.date:
      writer.line(`s += '"' + ${valueExpr}.toISOString() + '"';`);
      return;
    case TypeName.literal: {
      const literalValue = schema.def.value;

      writer.line(`s += ${JSON.stringify(JSON.stringify(literalValue) ?? "null")};`);
      return;
    }
    case TypeName.enum:
      writer.line(`s += JSON.stringify(${valueExpr});`);
      return;
    case TypeName.object:
      emitObjectAppend(context, schema, valueExpr);
      return;
    case TypeName.array: {
      const element = schema.def.element as ATS.AnyTypeSchema;
      const holder = hoist(context, valueExpr);
      const index = nextVar(context, "i");
      const item = nextVar(context, "e");

      writer.line(`s += "[";`);
      writer.line(`for (let ${index} = 0; ${index} < ${holder}.length; ${index}++) {`);
      writer.indent(() => {
        writer.line(`if (${index} !== 0) s += ",";`);
        writer.line(`const ${item} = ${holder}[${index}];`);
        emitAppend(context, element, item);
      });
      writer.line("}");
      writer.line(`s += "]";`);
      return;
    }
    case TypeName.tuple: {
      const items = (schema.def.items as readonly ATS.AnyTypeSchema[] | undefined) ?? [];
      const holder = hoist(context, valueExpr);

      writer.line(`s += "[";`);
      items.forEach((item, position) => {
        if (position > 0) writer.line(`s += ",";`);
        emitAppend(context, item, `${holder}[${position}]`);
      });
      writer.line(`s += "]";`);
      return;
    }
    case TypeName.record: {
      const valueSchema = schema.def.value as ATS.AnyTypeSchema;
      const holder = hoist(context, valueExpr);
      const keys = nextVar(context, "k");
      const index = nextVar(context, "i");
      const item = nextVar(context, "e");

      writer.line(`s += "{";`);
      writer.line(`const ${keys} = Object.keys(${holder});`);
      writer.line(`for (let ${index} = 0; ${index} < ${keys}.length; ${index}++) {`);
      writer.indent(() => {
        writer.line(`if (${index} !== 0) s += ",";`);
        writer.line(`s += JSON.stringify(${keys}[${index}]) + ":";`);
        writer.line(`const ${item} = ${holder}[${keys}[${index}]];`);
        emitAppend(context, valueSchema, item);
      });
      writer.line("}");
      writer.line(`s += "}";`);
      return;
    }
    case TypeName.union:
    case TypeName.discriminatedUnion:
    case TypeName.any:
    case TypeName.unknown:
      // Generic fallback: correctness over specialization for open shapes.
      writer.line(`s += JSON.stringify(${valueExpr}) ?? "null";`);
      return;
    default:
      throw new JITError(
        "UNSUPPORTED_SCHEMA",
        `serialize does not support ${schema.type} schemas (not representable in JSON)`
      );
  }
}

function emitObjectAppend(context: SerializeContext, schema: AnySchema, valueExpr: string): void {
  const writer = context.writer;
  const props = schema.def.props as Readonly<Record<string, ATS.AnyTypeSchema>>;
  const keys = Object.keys(props);
  const holder = hoist(context, valueExpr);
  const optionality = keys.map((key) => resolveSerializeWrappers(props[key]).optional);
  const firstRequired = optionality.indexOf(false);
  const needsRuntimeComma =
    optionality.some((optional, position) => optional && position < firstRequired) || firstRequired === -1;

  writer.line(`s += "{";`);

  if (keys.length === 0) {
    writer.line(`s += "}";`);
    return;
  }

  if (needsRuntimeComma) {
    // Optional fields may or may not open the object: track commas at runtime.
    const flag = nextVar(context, "f");

    writer.line(`let ${flag} = false;`);
    keys.forEach((key, position) => {
      const propExpr = emitPropertyAccess(holder, key);
      const keyPrefix = JSON.stringify(`${JSON.stringify(key)}:`);
      const emitProp = () => {
        writer.line(`if (${flag}) s += ",";`);
        writer.line(`${flag} = true;`);
        writer.line(`s += ${keyPrefix};`);
        emitAppend(context, props[key], propExpr);
      };

      if (optionality[position]) {
        writer.line(`if (${propExpr} !== undefined) {`);
        writer.indent(emitProp);
        writer.line("}");
      } else {
        emitProp();
      }
    });
    writer.line(`s += "}";`);
    return;
  }

  // Static comma layout: required fields anchor the commas at compile time.
  let hasPrevious = false;

  keys.forEach((key, position) => {
    const propExpr = emitPropertyAccess(holder, key);
    const keyToken = `${JSON.stringify(key)}:`;
    const prefix = hasPrevious ? `,${keyToken}` : keyToken;

    if (optionality[position]) {
      writer.line(`if (${propExpr} !== undefined) {`);
      writer.indent(() => {
        writer.line(`s += ${JSON.stringify(`,${keyToken}`)};`);
        emitAppend(context, props[key], propExpr);
      });
      writer.line("}");
      return;
    }

    writer.line(`s += ${JSON.stringify(prefix)};`);
    emitAppend(context, props[key], propExpr);
    hasPrevious = true;
  });
  writer.line(`s += "}";`);
}

function hoist(context: SerializeContext, expr: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(expr)) return expr;

  const holder = nextVar(context, "v");

  context.writer.line(`const ${holder} = ${expr};`);
  return holder;
}

interface ResolvedSerializeWrappers {
  readonly base: AnySchema;
  readonly optional: boolean;
  readonly nullable: boolean;
}

function resolveSerializeWrappers(schema: ATS.AnyTypeSchema): ResolvedSerializeWrappers {
  let current = schema as AnySchema;
  let optional = false;
  let nullable = false;

  while (true) {
    switch (current.type) {
      case TypeName.optional:
        optional = true;
        current = current.def.innerType as AnySchema;
        continue;
      case TypeName.nullable:
        nullable = true;
        current = current.def.innerType as AnySchema;
        continue;
      case TypeName.nullish:
        optional = true;
        nullable = true;
        current = current.def.innerType as AnySchema;
        continue;
      case TypeName.default:
      case TypeName.brand:
      case TypeName.readonly:
      case TypeName.refine:
      case TypeName.coerce:
      case TypeName.pipe:
      case TypeName.transform:
        current = current.def.innerType as AnySchema;
        continue;
      case TypeName.lazy:
        current = (current.def.getter as () => AnySchema)();
        continue;
      default:
        return { base: current, optional, nullable };
    }
  }
}
