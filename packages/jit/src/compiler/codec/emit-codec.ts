import type * as ATS from "../../core/ats/index.js";
import { TypeName } from "../../core/ats/index.js";
import { JITError } from "../../errors/index.js";
import { CodeWriter } from "../emitter/code-writer.js";
import { emitPropertyAccess } from "../source/access.js";
import { emitLiteral } from "../source/literal.js";

type AnySchema = ATS.AnyTypeSchema & { readonly def: Record<string, unknown> };

interface CodecContext {
  readonly writer: CodeWriter;
  readonly bindingNames: string[];
  readonly bindingValues: unknown[];
  readonly enumBindings: Map<AnySchema, string>;
  varCounter: number;
}

export interface EmittedCodec {
  readonly source: string;
  readonly bindingNames: readonly string[];
  readonly bindingValues: readonly unknown[];
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Emits a schema-specialized binary codec: `encode(value)` → `Uint8Array`
 * and `decode(bytes)` → value.
 *
 * Wire format (little-endian, no field tags — both sides share the schema):
 * numbers/dates float64, booleans one byte, strings u32 byte length + UTF-8,
 * enums one index byte, literals zero bytes, optional/nullable one presence
 * byte, arrays u32 count + elements, objects field-by-field in schema order.
 *
 * Encoding is two-pass: an exact sizing pass (strings encoded once into a
 * FIFO queue) and a single write pass over one exact allocation.
 */
export function emitCodec(schema: ATS.AnyTypeSchema): EmittedCodec {
  const writer = new CodeWriter();
  const context: CodecContext = {
    writer,
    bindingNames: [],
    bindingValues: [],
    enumBindings: new Map(),
    varCounter: 0,
  };
  const usesStrings = hasStringLeaf(schema);

  if (usesStrings) {
    bindValue(context, "__enc", textEncoder);
    bindValue(context, "__dec", textDecoder);
  }

  writer.line("function encode(value) {");
  writer.indent(() => {
    writer.line("let size = 0;");
    if (usesStrings) writer.line("const q = [];");
    emitSizePass(context, schema, "value");
    writer.line("const buf = new ArrayBuffer(size);");
    writer.line("const dv = new DataView(buf);");
    writer.line("const u8 = new Uint8Array(buf);");
    writer.line("let o = 0;");
    if (usesStrings) writer.line("let qi = 0;");
    emitWritePass(context, schema, "value");
    writer.line("return u8;");
  });
  writer.line("}");

  writer.line("function decode(input) {");
  writer.indent(() => {
    writer.line("const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);");
    writer.line("const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);");
    writer.line("let o = 0;");
    const result = emitReadPass(context, schema);

    writer.line(`return ${result};`);
  });
  writer.line("}");
  writer.line("return { encode: encode, decode: decode };");

  return {
    source: writer.toString(),
    bindingNames: context.bindingNames,
    bindingValues: context.bindingValues,
  };
}

function nextVar(context: CodecContext, prefix: string): string {
  return `${prefix}${++context.varCounter}`;
}

function bindValue(context: CodecContext, name: string, value: unknown): string {
  if (!context.bindingNames.includes(name)) {
    context.bindingNames.push(name);
    context.bindingValues.push(value);
  }

  return name;
}

function enumBinding(context: CodecContext, schema: AnySchema): string {
  let name = context.enumBindings.get(schema);

  if (!name) {
    name = `__c${context.bindingNames.length}`;
    context.bindingNames.push(name);
    context.bindingValues.push(Object.values(schema.def.values as Record<string, string | number>));
    context.enumBindings.set(schema, name);
  }

  return name;
}

interface ResolvedCodecWrappers {
  readonly base: AnySchema;
  readonly guarded: boolean;
}

function resolveCodecWrappers(schema: ATS.AnyTypeSchema): ResolvedCodecWrappers {
  let current = schema as AnySchema;
  let guarded = false;

  while (true) {
    switch (current.type) {
      case TypeName.optional:
      case TypeName.nullable:
      case TypeName.nullish:
        guarded = true;
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
        return { base: current, guarded };
    }
  }
}

/** True when the subtree contains a string leaf (drives the encode queue). */
function hasStringLeaf(schema: ATS.AnyTypeSchema): boolean {
  const base = resolveCodecWrappers(schema).base;

  switch (base.type) {
    case TypeName.string:
      return true;
    case TypeName.object: {
      const props = base.def.props as Readonly<Record<string, ATS.AnyTypeSchema>>;

      return Object.keys(props).some((key) => hasStringLeaf(props[key]));
    }
    case TypeName.array:
      return hasStringLeaf(base.def.element as ATS.AnyTypeSchema);
    default:
      return false;
  }
}

function emitSizePass(context: CodecContext, schema: ATS.AnyTypeSchema, valueExpr: string): void {
  const resolved = resolveCodecWrappers(schema);
  const writer = context.writer;

  if (resolved.guarded) {
    writer.line("size += 1;");
    writer.line(`if (${valueExpr} != null) {`);
    writer.indent(() => {
      emitBaseSize(context, resolved.base, valueExpr);
    });
    writer.line("}");
    return;
  }

  emitBaseSize(context, resolved.base, valueExpr);
}

function emitBaseSize(context: CodecContext, schema: AnySchema, valueExpr: string): void {
  const writer = context.writer;

  switch (schema.type) {
    case TypeName.number:
    case TypeName.int:
    case TypeName.nan:
    case TypeName.date:
      writer.line("size += 8;");
      return;
    case TypeName.boolean:
    case TypeName.enum:
      writer.line("size += 1;");
      return;
    case TypeName.literal:
    case TypeName.null:
    case TypeName.undefined:
      return;
    case TypeName.string: {
      const chunk = nextVar(context, "c");

      writer.line(`const ${chunk} = __enc.encode(${valueExpr});`);
      writer.line(`q[q.length] = ${chunk};`);
      writer.line(`size += 4 + ${chunk}.byteLength;`);
      return;
    }
    case TypeName.object: {
      const props = schema.def.props as Readonly<Record<string, ATS.AnyTypeSchema>>;
      const holder = hoist(context, valueExpr);

      for (const key of Object.keys(props)) {
        emitSizePass(context, props[key], emitPropertyAccess(holder, key));
      }
      return;
    }
    case TypeName.array: {
      const element = schema.def.element as ATS.AnyTypeSchema;
      const holder = hoist(context, valueExpr);
      const index = nextVar(context, "i");
      const item = nextVar(context, "e");

      writer.line("size += 4;");
      writer.line(`for (let ${index} = 0; ${index} < ${holder}.length; ${index}++) {`);
      writer.indent(() => {
        writer.line(`const ${item} = ${holder}[${index}];`);
        emitSizePass(context, element, item);
      });
      writer.line("}");
      return;
    }
    default:
      throw new JITError("UNSUPPORTED_SCHEMA", `binary codec does not support ${schema.type} schemas`);
  }
}

function emitWritePass(context: CodecContext, schema: ATS.AnyTypeSchema, valueExpr: string): void {
  const resolved = resolveCodecWrappers(schema);
  const writer = context.writer;

  if (resolved.guarded) {
    writer.line(`if (${valueExpr} === undefined) {`);
    writer.indent(() => {
      writer.line("u8[o] = 0; o += 1;");
    });
    writer.line(`} else if (${valueExpr} === null) {`);
    writer.indent(() => {
      writer.line("u8[o] = 1; o += 1;");
    });
    writer.line("} else {");
    writer.indent(() => {
      writer.line("u8[o] = 2; o += 1;");
      emitBaseWrite(context, resolved.base, valueExpr);
    });
    writer.line("}");
    return;
  }

  emitBaseWrite(context, resolved.base, valueExpr);
}

function emitBaseWrite(context: CodecContext, schema: AnySchema, valueExpr: string): void {
  const writer = context.writer;

  switch (schema.type) {
    case TypeName.number:
    case TypeName.int:
    case TypeName.nan:
      writer.line(`dv.setFloat64(o, ${valueExpr}, true); o += 8;`);
      return;
    case TypeName.date:
      writer.line(`dv.setFloat64(o, ${valueExpr}.getTime(), true); o += 8;`);
      return;
    case TypeName.boolean:
      writer.line(`u8[o] = ${valueExpr} ? 1 : 0; o += 1;`);
      return;
    case TypeName.enum:
      writer.line(`u8[o] = ${enumBinding(context, schema)}.indexOf(${valueExpr}); o += 1;`);
      return;
    case TypeName.literal:
    case TypeName.null:
    case TypeName.undefined:
      return;
    case TypeName.string: {
      const chunk = nextVar(context, "c");

      writer.line(`const ${chunk} = q[qi++];`);
      writer.line(`dv.setUint32(o, ${chunk}.byteLength, true); o += 4;`);
      writer.line(`u8.set(${chunk}, o); o += ${chunk}.byteLength;`);
      return;
    }
    case TypeName.object: {
      const props = schema.def.props as Readonly<Record<string, ATS.AnyTypeSchema>>;
      const holder = hoist(context, valueExpr);

      for (const key of Object.keys(props)) {
        emitWritePass(context, props[key], emitPropertyAccess(holder, key));
      }
      return;
    }
    case TypeName.array: {
      const element = schema.def.element as ATS.AnyTypeSchema;
      const holder = hoist(context, valueExpr);
      const index = nextVar(context, "i");
      const item = nextVar(context, "e");

      writer.line(`dv.setUint32(o, ${holder}.length, true); o += 4;`);
      writer.line(`for (let ${index} = 0; ${index} < ${holder}.length; ${index}++) {`);
      writer.indent(() => {
        writer.line(`const ${item} = ${holder}[${index}];`);
        emitWritePass(context, element, item);
      });
      writer.line("}");
      return;
    }
    default:
      throw new JITError("UNSUPPORTED_SCHEMA", `binary codec does not support ${schema.type} schemas`);
  }
}

/** Emits read statements and returns the expression holding the value. */
function emitReadPass(context: CodecContext, schema: ATS.AnyTypeSchema): string {
  const resolved = resolveCodecWrappers(schema);
  const writer = context.writer;

  if (resolved.guarded) {
    const flag = nextVar(context, "p");
    const holder = nextVar(context, "r");

    writer.line(`const ${flag} = u8[o]; o += 1;`);
    writer.line(`let ${holder};`);
    writer.line(`if (${flag} === 1) {`);
    writer.indent(() => {
      writer.line(`${holder} = null;`);
    });
    writer.line(`} else if (${flag} === 2) {`);
    writer.indent(() => {
      writer.line(`${holder} = ${emitBaseRead(context, resolved.base)};`);
    });
    writer.line("}");
    return holder;
  }

  return emitBaseRead(context, resolved.base);
}

function emitBaseRead(context: CodecContext, schema: AnySchema): string {
  const writer = context.writer;

  switch (schema.type) {
    case TypeName.number:
    case TypeName.int:
    case TypeName.nan: {
      const holder = nextVar(context, "n");

      writer.line(`const ${holder} = dv.getFloat64(o, true); o += 8;`);
      return holder;
    }
    case TypeName.date: {
      const holder = nextVar(context, "d");

      writer.line(`const ${holder} = new Date(dv.getFloat64(o, true)); o += 8;`);
      return holder;
    }
    case TypeName.boolean: {
      const holder = nextVar(context, "b");

      writer.line(`const ${holder} = u8[o] !== 0; o += 1;`);
      return holder;
    }
    case TypeName.enum: {
      const holder = nextVar(context, "n");

      writer.line(`const ${holder} = ${enumBinding(context, schema)}[u8[o]]; o += 1;`);
      return holder;
    }
    case TypeName.literal:
      return emitLiteral(schema.def.value as never);
    case TypeName.null:
      return "null";
    case TypeName.undefined:
      return "undefined";
    case TypeName.string: {
      const length = nextVar(context, "l");
      const holder = nextVar(context, "t");

      writer.line(`const ${length} = dv.getUint32(o, true); o += 4;`);
      writer.line(`const ${holder} = __dec.decode(u8.subarray(o, o + ${length})); o += ${length};`);
      return holder;
    }
    case TypeName.object: {
      const props = schema.def.props as Readonly<Record<string, ATS.AnyTypeSchema>>;
      const entries = Object.keys(props).map((key) => `${emitLiteral(key)}: ${emitReadPass(context, props[key])}`);

      return `{ ${entries.join(", ")} }`;
    }
    case TypeName.array: {
      const element = schema.def.element as ATS.AnyTypeSchema;
      const length = nextVar(context, "l");
      const out = nextVar(context, "a");
      const index = nextVar(context, "i");

      writer.line(`const ${length} = dv.getUint32(o, true); o += 4;`);
      writer.line(`const ${out} = new Array(${length});`);
      writer.line(`for (let ${index} = 0; ${index} < ${length}; ${index}++) {`);
      writer.indent(() => {
        writer.line(`${out}[${index}] = ${emitReadPass(context, element)};`);
      });
      writer.line("}");
      return out;
    }
    default:
      throw new JITError("UNSUPPORTED_SCHEMA", `binary codec does not support ${schema.type} schemas`);
  }
}

function hoist(context: CodecContext, expr: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(expr)) return expr;

  const holder = nextVar(context, "v");

  context.writer.line(`const ${holder} = ${expr};`);
  return holder;
}
