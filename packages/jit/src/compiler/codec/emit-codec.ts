import type * as ATS from "../../core/ats/index.js";
import { TypeName } from "../../core/ats/index.js";
import { JITError } from "../../errors/index.js";
import { Parse } from "../../shared/index.js";
import { CodeWriter } from "../emitter/code-writer.js";
import { emitPropertyAccess } from "../source/access.js";
import { emitSchemaGuard } from "../source/guard.js";
import { emitLiteral } from "../source/literal.js";

type AnySchema = ATS.AnyTypeSchema & { readonly def: Record<string, unknown> };

interface CodecContext {
  readonly writer: CodeWriter;
  readonly bindingNames: string[];
  readonly bindingValues: unknown[];
  readonly enumBindings: Map<AnySchema, string>;
  varCounter: number;
}

export interface CodecEmitOptions {
  /** Wire format version written as byte 0 and checked on decode (0-255). */
  readonly version?: number;
}

export interface EmittedCodec {
  readonly source: string;
  readonly bindingNames: readonly string[];
  readonly bindingValues: readonly unknown[];
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Emits a schema-specialized binary codec: `encode(value)` → `Uint8Array`,
 * `encodeInto(value, target)` → bytes written, `decode(bytes)` → value.
 *
 * Wire format v2 (little-endian, no field names — both sides share the
 * schema):
 * - byte 0: schema version; decode rejects a mismatch loudly instead of
 *   silently corrupting on schema drift.
 * - numbers/dates float64; `int` schemas int32 (guarded — out-of-range
 *   throws instead of truncating); bigint int64; booleans/enums one byte.
 * - strings: u32 byte length + UTF-8, written straight into the buffer
 *   with `TextEncoder.encodeInto` (single measurement+write step).
 * - object optionals: a bitmask block at the object start — 2 bits per
 *   optional/nullable field (00 absent, 01 null, 10 present) — so absent
 *   fields never shift the layout of what follows.
 * - arrays/sets/maps/records: u32 count + entries; tuples fixed slots
 *   (+ u32-counted rest); literals zero bytes.
 * - unions: 1 tag byte picked by the first matching option guard;
 *   discriminated unions: 1 tag byte from the discriminator literal;
 *   intersections of objects: options encoded in sequence.
 *
 * Encoding is single-pass: a worst-case sizing pass (strings count as
 * `4 + 3*length`), one allocation, one write via the shared `_write`, and
 * an exact-length subarray out. `any`/`unknown` are rejected — a binary
 * layout requires rigid types.
 */
export function emitCodec(schema: ATS.AnyTypeSchema, options: CodecEmitOptions = {}): EmittedCodec {
  const version = options.version ?? 1;

  if (!Number.isInteger(version) || version < 0 || version > 255) {
    throw new JITError("INVALID_OPERATION", `codec version must be an integer in [0, 255], got ${version}`);
  }

  const writer = new CodeWriter();
  const context: CodecContext = {
    writer,
    bindingNames: [],
    bindingValues: [],
    enumBindings: new Map(),
    varCounter: 0,
  };
  const usesStrings = hasStringLeaf(schema, new Set());

  if (usesStrings) {
    bindValue(context, "__enc", textEncoder);
    bindValue(context, "__dec", textDecoder);
  }

  writer.line("function _write(value, u8, dv, o) {");
  writer.indent(() => {
    emitWrite(context, schema, "value");
    writer.line("return o;");
  });
  writer.line("}");

  writer.line("function encode(value) {");
  writer.indent(() => {
    writer.line("let size = 1;");
    emitSize(context, schema, "value");
    writer.line("const buf = new ArrayBuffer(size);");
    writer.line("const dv = new DataView(buf);");
    writer.line("const u8 = new Uint8Array(buf);");
    writer.line(`u8[0] = ${version};`);
    writer.line("return u8.subarray(0, _write(value, u8, dv, 1));");
  });
  writer.line("}");

  writer.line("function encodeInto(value, target) {");
  writer.indent(() => {
    writer.line("if (!(target instanceof Uint8Array)) {");
    writer.indent(() => {
      writer.line('throw new TypeError("jit codec: encodeInto target must be a Uint8Array");');
    });
    writer.line("}");
    writer.line('if (target.length < 1) throw new RangeError("jit codec: target buffer too small");');
    writer.line("const dv = new DataView(target.buffer, target.byteOffset, target.byteLength);");
    writer.line(`target[0] = ${version};`);
    writer.line("return _write(value, target, dv, 1);");
  });
  writer.line("}");

  writer.line("function decode(input) {");
  writer.indent(() => {
    writer.line("const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);");
    writer.line("const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);");
    writer.line(`if (u8.length < 1 || u8[0] !== ${version}) {`);
    writer.indent(() => {
      writer.line(
        `throw new RangeError("jit codec: schema version mismatch: expected ${version}, got " + (u8.length < 1 ? "empty buffer" : u8[0]));`
      );
    });
    writer.line("}");
    writer.line("let o = 1;");
    const result = emitRead(context, schema);

    writer.line(`return ${result};`);
  });
  writer.line("}");
  writer.line("return { encode: encode, encodeInto: encodeInto, decode: decode };");

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

/** True when the subtree serializes at least one string (drives TextEncoder bindings). */
function hasStringLeaf(schema: ATS.AnyTypeSchema, seen: Set<ATS.AnyTypeSchema>): boolean {
  if (seen.has(schema)) return false;
  seen.add(schema);

  const base = resolveCodecWrappers(schema).base;

  switch (base.type) {
    case TypeName.string:
    case TypeName.record:
      return true;
    case TypeName.object: {
      const props = base.def.props as Readonly<Record<string, ATS.AnyTypeSchema>>;

      return Object.keys(props).some((key) => hasStringLeaf(props[key], seen));
    }
    case TypeName.array:
    case TypeName.set:
      return hasStringLeaf(base.def.element as ATS.AnyTypeSchema, seen);
    case TypeName.map:
      return (
        hasStringLeaf(base.def.key as ATS.AnyTypeSchema, seen) ||
        hasStringLeaf(base.def.value as ATS.AnyTypeSchema, seen)
      );
    case TypeName.tuple: {
      const items = (base.def.items as readonly ATS.AnyTypeSchema[] | undefined) ?? [];
      const rest = base.def.rest as ATS.AnyTypeSchema | undefined;

      return items.some((item) => hasStringLeaf(item, seen)) || (rest !== undefined && hasStringLeaf(rest, seen));
    }
    case TypeName.union:
    case TypeName.discriminatedUnion:
    case TypeName.intersection: {
      const opts = base.def.options as readonly ATS.AnyTypeSchema[];

      return opts.some((option) => hasStringLeaf(option, seen));
    }
    default:
      return false;
  }
}

interface GuardedProp {
  readonly key: string;
  readonly bit: number;
}

/** Object layout: which props are optional/nullable and their bitmask slots. */
function objectLayout(schema: AnySchema): { guarded: GuardedProp[]; maskBytes: number } {
  const props = schema.def.props as Readonly<Record<string, ATS.AnyTypeSchema>>;
  const guarded: GuardedProp[] = [];

  for (const key of Object.keys(props)) {
    if (resolveCodecWrappers(props[key]).guarded) {
      guarded.push({ key, bit: guarded.length });
    }
  }

  return { guarded, maskBytes: Math.ceil(guarded.length / 4) };
}

function unsupported(kind: string): never {
  throw new JITError(
    "UNSUPPORTED_SCHEMA",
    `binary codec does not support ${kind} schemas — a binary layout requires rigid, explicitly-typed structures`
  );
}

/** Options of a discriminated union with their literal tag values, in order. */
function taggedOptions(schema: AnySchema): { option: AnySchema; tag: string | number }[] {
  const discriminator = schema.def.discriminator as string;
  const options = schema.def.options as readonly ATS.AnyTypeSchema[];
  const tagged = options.map((option) => {
    const base = resolveCodecWrappers(option).base;

    if (base.type !== TypeName.object) unsupported("discriminated union with non-object option");

    const prop = (base.def.props as Record<string, ATS.AnyTypeSchema>)[discriminator];
    const propBase = prop ? resolveCodecWrappers(prop).base : undefined;

    if (propBase?.type !== TypeName.literal) unsupported("discriminated union without literal tag");

    const value = (propBase as AnySchema).def.value;

    if (typeof value !== "string" && typeof value !== "number") unsupported("discriminated union with non-scalar tag");
    return { option: resolveCodecWrappers(option).base, tag: value };
  });

  if (tagged.length > 255) unsupported("union with more than 255 options");
  return tagged;
}

// ---------------------------------------------------------------------------
// sizing pass (worst case; strings count 4 + 3*length, no double encoding)
// ---------------------------------------------------------------------------

function emitSize(context: CodecContext, schema: ATS.AnyTypeSchema, valueExpr: string): void {
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
    case TypeName.nan:
    case TypeName.date:
    case TypeName.bigint:
      writer.line("size += 8;");
      return;
    case TypeName.int:
      writer.line("size += 4;");
      return;
    case TypeName.boolean:
    case TypeName.enum:
      writer.line("size += 1;");
      return;
    case TypeName.literal:
    case TypeName.null:
    case TypeName.undefined:
      return;
    case TypeName.string:
      writer.line(`size += 4 + ${valueExpr}.length * 3;`);
      return;
    case TypeName.object: {
      const props = schema.def.props as Readonly<Record<string, ATS.AnyTypeSchema>>;
      const layout = objectLayout(schema);
      const holder = hoist(context, valueExpr);

      if (layout.maskBytes > 0) writer.line(`size += ${layout.maskBytes};`);

      for (const key of Object.keys(props)) {
        const prop = props[key];
        const resolved = resolveCodecWrappers(prop);
        const propExpr = emitPropertyAccess(holder, key);

        if (resolved.guarded) {
          writer.line(`if (${propExpr} != null) {`);
          writer.indent(() => {
            emitBaseSize(context, resolved.base, propExpr);
          });
          writer.line("}");
        } else {
          emitBaseSize(context, resolved.base, propExpr);
        }
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
        emitSize(context, element, item);
      });
      writer.line("}");
      return;
    }
    case TypeName.tuple: {
      const items = (schema.def.items as readonly ATS.AnyTypeSchema[] | undefined) ?? [];
      const rest = schema.def.rest as ATS.AnyTypeSchema | undefined;
      const holder = hoist(context, valueExpr);

      items.forEach((item, position) => {
        emitSize(context, item, `${holder}[${position}]`);
      });

      if (rest) {
        const index = nextVar(context, "i");

        writer.line("size += 4;");
        writer.line(`for (let ${index} = ${items.length}; ${index} < ${holder}.length; ${index}++) {`);
        writer.indent(() => {
          emitSize(context, rest, `${holder}[${index}]`);
        });
        writer.line("}");
      }
      return;
    }
    case TypeName.set: {
      const element = schema.def.element as ATS.AnyTypeSchema;
      const holder = hoist(context, valueExpr);
      const item = nextVar(context, "e");

      writer.line("size += 4;");
      writer.line(`for (const ${item} of ${holder}) {`);
      writer.indent(() => {
        emitSize(context, element, item);
      });
      writer.line("}");
      return;
    }
    case TypeName.map: {
      const keySchema = schema.def.key as ATS.AnyTypeSchema;
      const valueSchema = schema.def.value as ATS.AnyTypeSchema;
      const holder = hoist(context, valueExpr);
      const entry = nextVar(context, "e");

      writer.line("size += 4;");
      writer.line(`for (const ${entry} of ${holder}) {`);
      writer.indent(() => {
        emitSize(context, keySchema, `${entry}[0]`);
        emitSize(context, valueSchema, `${entry}[1]`);
      });
      writer.line("}");
      return;
    }
    case TypeName.record: {
      const valueSchema = schema.def.value as ATS.AnyTypeSchema;
      const holder = hoist(context, valueExpr);
      const keys = nextVar(context, "k");
      const index = nextVar(context, "i");

      writer.line(`const ${keys} = Object.keys(${holder});`);
      writer.line("size += 4;");
      writer.line(`for (let ${index} = 0; ${index} < ${keys}.length; ${index}++) {`);
      writer.indent(() => {
        writer.line(`size += 4 + ${keys}[${index}].length * 3;`);
        emitSize(context, valueSchema, `${holder}[${keys}[${index}]]`);
      });
      writer.line("}");
      return;
    }
    case TypeName.union: {
      const options = schema.def.options as readonly ATS.AnyTypeSchema[];
      const holder = hoist(context, valueExpr);

      if (options.length === 0 || options.length > 255) unsupported("union with 0 or more than 255 options");

      writer.line("size += 1;");
      options.forEach((option, position) => {
        writer.line(`${position === 0 ? "if" : "} else if"} (${emitSchemaGuard(option, holder)}) {`);
        writer.indent(() => {
          emitSize(context, option, holder);
        });
      });
      writer.line("} else {");
      writer.indent(() => {
        writer.line('throw new RangeError("jit codec: value matched no union option");');
      });
      writer.line("}");
      return;
    }
    case TypeName.discriminatedUnion: {
      const discriminator = schema.def.discriminator as string;
      const tagged = taggedOptions(schema);
      const holder = hoist(context, valueExpr);
      const tag = nextVar(context, "t");

      writer.line(`const ${tag} = ${emitPropertyAccess(holder, discriminator)};`);
      writer.line("size += 1;");
      tagged.forEach((entry, position) => {
        writer.line(`${position === 0 ? "if" : "} else if"} (${tag} === ${emitLiteral(entry.tag)}) {`);
        writer.indent(() => {
          emitBaseSize(context, entry.option, holder);
        });
      });
      writer.line("} else {");
      writer.indent(() => {
        writer.line(`throw new RangeError("jit codec: unknown discriminator value: " + ${tag});`);
      });
      writer.line("}");
      return;
    }
    case TypeName.intersection: {
      const options = schema.def.options as readonly ATS.AnyTypeSchema[];
      const holder = hoist(context, valueExpr);

      for (const option of options) {
        const base = resolveCodecWrappers(option).base;

        if (base.type !== TypeName.object) unsupported("intersection of non-object");
        emitBaseSize(context, base, holder);
      }
      return;
    }
    default:
      unsupported(schema.type);
  }
}

// ---------------------------------------------------------------------------
// write pass (shared by encode and encodeInto; bounds-safe via DataView)
// ---------------------------------------------------------------------------

function emitWrite(context: CodecContext, schema: ATS.AnyTypeSchema, valueExpr: string): void {
  const resolved = resolveCodecWrappers(schema);
  const writer = context.writer;

  if (resolved.guarded) {
    writer.line(`if (${valueExpr} === undefined) {`);
    writer.indent(() => {
      writer.line("dv.setUint8(o, 0); o += 1;");
    });
    writer.line(`} else if (${valueExpr} === null) {`);
    writer.indent(() => {
      writer.line("dv.setUint8(o, 1); o += 1;");
    });
    writer.line("} else {");
    writer.indent(() => {
      writer.line("dv.setUint8(o, 2); o += 1;");
      emitBaseWrite(context, resolved.base, valueExpr);
    });
    writer.line("}");
    return;
  }

  emitBaseWrite(context, resolved.base, valueExpr);
}

function emitStringWrite(context: CodecContext, valueExpr: string): void {
  const writer = context.writer;
  const result = nextVar(context, "w");

  writer.line(`const ${result} = __enc.encodeInto(${valueExpr}, u8.subarray(o + 4));`);
  writer.line(`if (${result}.read !== ${valueExpr}.length) {`);
  writer.indent(() => {
    writer.line('throw new RangeError("jit codec: target buffer too small");');
  });
  writer.line("}");
  writer.line(`dv.setUint32(o, ${result}.written, true); o += 4 + ${result}.written;`);
}

function emitBaseWrite(context: CodecContext, schema: AnySchema, valueExpr: string): void {
  const writer = context.writer;

  switch (schema.type) {
    case TypeName.number:
    case TypeName.nan:
      writer.line(`dv.setFloat64(o, ${valueExpr}, true); o += 8;`);
      return;
    case TypeName.int:
      writer.line(`if (${valueExpr} !== (${valueExpr} | 0)) {`);
      writer.indent(() => {
        writer.line(`throw new RangeError("jit codec: int32 overflow: " + ${valueExpr});`);
      });
      writer.line("}");
      writer.line(`dv.setInt32(o, ${valueExpr}, true); o += 4;`);
      return;
    case TypeName.bigint:
      writer.line(`dv.setBigInt64(o, ${valueExpr}, true); o += 8;`);
      return;
    case TypeName.date:
      writer.line(`dv.setFloat64(o, ${valueExpr}.getTime(), true); o += 8;`);
      return;
    case TypeName.boolean:
      writer.line(`dv.setUint8(o, ${valueExpr} ? 1 : 0); o += 1;`);
      return;
    case TypeName.enum:
      writer.line(`dv.setUint8(o, ${enumBinding(context, schema)}.indexOf(${valueExpr})); o += 1;`);
      return;
    case TypeName.literal:
    case TypeName.null:
    case TypeName.undefined:
      return;
    case TypeName.string:
      emitStringWrite(context, valueExpr);
      return;
    case TypeName.object: {
      const props = schema.def.props as Readonly<Record<string, ATS.AnyTypeSchema>>;
      const layout = objectLayout(schema);
      const holder = hoist(context, valueExpr);
      const maskVars: string[] = [];

      for (let byte = 0; byte < layout.maskBytes; byte++) {
        const mask = nextVar(context, "m");

        maskVars.push(mask);
        writer.line(`let ${mask} = 0;`);
      }

      for (const guarded of layout.guarded) {
        const propExpr = emitPropertyAccess(holder, guarded.key);
        const mask = maskVars[guarded.bit >> 2];
        const shift = (guarded.bit & 3) * 2;

        writer.line(
          `if (${propExpr} === null) ${mask} |= ${1 << shift}; else if (${propExpr} !== undefined) ${mask} |= ${2 << shift};`
        );
      }

      for (const mask of maskVars) {
        writer.line(`dv.setUint8(o, ${mask}); o += 1;`);
      }

      for (const key of Object.keys(props)) {
        const resolved = resolveCodecWrappers(props[key]);
        const propExpr = emitPropertyAccess(holder, key);

        if (resolved.guarded) {
          writer.line(`if (${propExpr} != null) {`);
          writer.indent(() => {
            emitBaseWrite(context, resolved.base, propExpr);
          });
          writer.line("}");
        } else {
          emitBaseWrite(context, resolved.base, propExpr);
        }
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
        emitWrite(context, element, item);
      });
      writer.line("}");
      return;
    }
    case TypeName.tuple: {
      const items = (schema.def.items as readonly ATS.AnyTypeSchema[] | undefined) ?? [];
      const rest = schema.def.rest as ATS.AnyTypeSchema | undefined;
      const holder = hoist(context, valueExpr);

      items.forEach((item, position) => {
        emitWrite(context, item, `${holder}[${position}]`);
      });

      if (rest) {
        const index = nextVar(context, "i");

        writer.line(`dv.setUint32(o, ${holder}.length - ${items.length}, true); o += 4;`);
        writer.line(`for (let ${index} = ${items.length}; ${index} < ${holder}.length; ${index}++) {`);
        writer.indent(() => {
          emitWrite(context, rest, `${holder}[${index}]`);
        });
        writer.line("}");
      }
      return;
    }
    case TypeName.set: {
      const element = schema.def.element as ATS.AnyTypeSchema;
      const holder = hoist(context, valueExpr);
      const item = nextVar(context, "e");

      writer.line(`dv.setUint32(o, ${holder}.size, true); o += 4;`);
      writer.line(`for (const ${item} of ${holder}) {`);
      writer.indent(() => {
        emitWrite(context, element, item);
      });
      writer.line("}");
      return;
    }
    case TypeName.map: {
      const keySchema = schema.def.key as ATS.AnyTypeSchema;
      const valueSchema = schema.def.value as ATS.AnyTypeSchema;
      const holder = hoist(context, valueExpr);
      const entry = nextVar(context, "e");

      writer.line(`dv.setUint32(o, ${holder}.size, true); o += 4;`);
      writer.line(`for (const ${entry} of ${holder}) {`);
      writer.indent(() => {
        emitWrite(context, keySchema, `${entry}[0]`);
        emitWrite(context, valueSchema, `${entry}[1]`);
      });
      writer.line("}");
      return;
    }
    case TypeName.record: {
      const valueSchema = schema.def.value as ATS.AnyTypeSchema;
      const holder = hoist(context, valueExpr);
      const keys = nextVar(context, "k");
      const index = nextVar(context, "i");

      writer.line(`const ${keys} = Object.keys(${holder});`);
      writer.line(`dv.setUint32(o, ${keys}.length, true); o += 4;`);
      writer.line(`for (let ${index} = 0; ${index} < ${keys}.length; ${index}++) {`);
      writer.indent(() => {
        emitStringWrite(context, `${keys}[${index}]`);
        emitWrite(context, valueSchema, `${holder}[${keys}[${index}]]`);
      });
      writer.line("}");
      return;
    }
    case TypeName.union: {
      const options = schema.def.options as readonly ATS.AnyTypeSchema[];
      const holder = hoist(context, valueExpr);

      options.forEach((option, position) => {
        writer.line(`${position === 0 ? "if" : "} else if"} (${emitSchemaGuard(option, holder)}) {`);
        writer.indent(() => {
          writer.line(`dv.setUint8(o, ${position}); o += 1;`);
          emitWrite(context, option, holder);
        });
      });
      writer.line("} else {");
      writer.indent(() => {
        writer.line('throw new RangeError("jit codec: value matched no union option");');
      });
      writer.line("}");
      return;
    }
    case TypeName.discriminatedUnion: {
      const discriminator = schema.def.discriminator as string;
      const tagged = taggedOptions(schema);
      const holder = hoist(context, valueExpr);
      const tag = nextVar(context, "t");

      writer.line(`const ${tag} = ${emitPropertyAccess(holder, discriminator)};`);
      tagged.forEach((entry, position) => {
        writer.line(`${position === 0 ? "if" : "} else if"} (${tag} === ${emitLiteral(entry.tag)}) {`);
        writer.indent(() => {
          writer.line(`dv.setUint8(o, ${position}); o += 1;`);
          emitBaseWrite(context, entry.option, holder);
        });
      });
      writer.line("} else {");
      writer.indent(() => {
        writer.line(`throw new RangeError("jit codec: unknown discriminator value: " + ${tag});`);
      });
      writer.line("}");
      return;
    }
    case TypeName.intersection: {
      const options = schema.def.options as readonly ATS.AnyTypeSchema[];
      const holder = hoist(context, valueExpr);

      for (const option of options) {
        const base = resolveCodecWrappers(option).base;

        if (base.type !== TypeName.object) unsupported("intersection of non-object");
        emitBaseWrite(context, base, holder);
      }
      return;
    }
    default:
      unsupported(schema.type);
  }
}

// ---------------------------------------------------------------------------
// read pass
// ---------------------------------------------------------------------------

/** Emits read statements and returns the expression holding the value. */
function emitRead(context: CodecContext, schema: ATS.AnyTypeSchema): string {
  const resolved = resolveCodecWrappers(schema);
  const writer = context.writer;

  if (resolved.guarded) {
    const flag = nextVar(context, "p");
    const holder = nextVar(context, "r");

    writer.line(`const ${flag} = dv.getUint8(o); o += 1;`);
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

function emitStringRead(context: CodecContext): string {
  const writer = context.writer;
  const length = nextVar(context, "l");
  const holder = nextVar(context, "t");

  writer.line(`const ${length} = dv.getUint32(o, true); o += 4;`);
  writer.line(`if (o + ${length} > u8.length) throw new RangeError("jit codec: truncated buffer");`);
  writer.line(`const ${holder} = __dec.decode(u8.subarray(o, o + ${length})); o += ${length};`);
  return holder;
}

/** Reads one object body and returns its `key: expr` entries (no braces). */
function emitObjectEntries(context: CodecContext, schema: AnySchema): string[] {
  const writer = context.writer;
  const props = schema.def.props as Readonly<Record<string, ATS.AnyTypeSchema>>;
  const layout = objectLayout(schema);
  const maskVars: string[] = [];
  const guardedByKey = new Map(layout.guarded.map((entry) => [entry.key, entry]));

  for (let byte = 0; byte < layout.maskBytes; byte++) {
    const mask = nextVar(context, "m");

    maskVars.push(mask);
    writer.line(`const ${mask} = dv.getUint8(o); o += 1;`);
  }

  const entries: string[] = [];

  for (const key of Object.keys(props)) {
    const guarded = guardedByKey.get(key);

    if (!guarded) {
      entries.push(`${emitLiteral(key)}: ${emitRead(context, props[key])}`);
      continue;
    }

    const resolved = resolveCodecWrappers(props[key]);
    const mask = maskVars[guarded.bit >> 2];
    const shift = (guarded.bit & 3) * 2;
    const state = nextVar(context, "s");
    const holder = nextVar(context, "r");

    writer.line(`const ${state} = (${mask} >> ${shift}) & 3;`);
    writer.line(`let ${holder};`);
    writer.line(`if (${state} === 1) {`);
    writer.indent(() => {
      writer.line(`${holder} = null;`);
    });
    writer.line(`} else if (${state} === 2) {`);
    writer.indent(() => {
      writer.line(`${holder} = ${emitBaseRead(context, resolved.base)};`);
    });
    writer.line("}");
    entries.push(`${emitLiteral(key)}: ${holder}`);
  }

  return entries;
}

function emitBaseRead(context: CodecContext, schema: AnySchema): string {
  const writer = context.writer;

  switch (schema.type) {
    case TypeName.number:
    case TypeName.nan: {
      const holder = nextVar(context, "n");

      writer.line(`const ${holder} = dv.getFloat64(o, true); o += 8;`);
      return holder;
    }
    case TypeName.int: {
      const holder = nextVar(context, "n");

      writer.line(`const ${holder} = dv.getInt32(o, true); o += 4;`);
      return holder;
    }
    case TypeName.bigint: {
      const holder = nextVar(context, "n");

      writer.line(`const ${holder} = dv.getBigInt64(o, true); o += 8;`);
      return holder;
    }
    case TypeName.date: {
      const holder = nextVar(context, "d");

      writer.line(`const ${holder} = new Date(dv.getFloat64(o, true)); o += 8;`);
      return holder;
    }
    case TypeName.boolean: {
      const holder = nextVar(context, "b");

      writer.line(`const ${holder} = dv.getUint8(o) !== 0; o += 1;`);
      return holder;
    }
    case TypeName.enum: {
      const holder = nextVar(context, "n");

      writer.line(`const ${holder} = ${enumBinding(context, schema)}[dv.getUint8(o)]; o += 1;`);
      return holder;
    }
    case TypeName.literal:
      return emitLiteral(schema.def.value as never);
    case TypeName.null:
      return "null";
    case TypeName.undefined:
      return "undefined";
    case TypeName.string:
      return emitStringRead(context);
    case TypeName.object:
      return `{ ${emitObjectEntries(context, schema).join(", ")} }`;
    case TypeName.array: {
      const element = schema.def.element as ATS.AnyTypeSchema;
      const length = nextVar(context, "l");
      const out = nextVar(context, "a");
      const index = nextVar(context, "i");

      writer.line(`const ${length} = dv.getUint32(o, true); o += 4;`);
      writer.line(`const ${out} = new Array(${length});`);
      writer.line(`for (let ${index} = 0; ${index} < ${length}; ${index}++) {`);
      writer.indent(() => {
        writer.line(`${out}[${index}] = ${emitRead(context, element)};`);
      });
      writer.line("}");
      return out;
    }
    case TypeName.tuple: {
      const items = (schema.def.items as readonly ATS.AnyTypeSchema[] | undefined) ?? [];
      const rest = schema.def.rest as ATS.AnyTypeSchema | undefined;
      const slots = items.map((item) => {
        const slot = nextVar(context, "e");

        writer.line(`const ${slot} = ${emitRead(context, item)};`);
        return slot;
      });
      const out = nextVar(context, "a");

      if (!rest) {
        writer.line(`const ${out} = [${slots.join(", ")}];`);
        return out;
      }

      const length = nextVar(context, "l");
      const index = nextVar(context, "i");

      writer.line(`const ${length} = dv.getUint32(o, true); o += 4;`);
      writer.line(`const ${out} = new Array(${items.length} + ${length});`);
      slots.forEach((slot, position) => {
        writer.line(`${out}[${position}] = ${slot};`);
      });
      writer.line(`for (let ${index} = 0; ${index} < ${length}; ${index}++) {`);
      writer.indent(() => {
        writer.line(`${out}[${items.length} + ${index}] = ${emitRead(context, rest)};`);
      });
      writer.line("}");
      return out;
    }
    case TypeName.set: {
      const element = schema.def.element as ATS.AnyTypeSchema;
      const length = nextVar(context, "l");
      const out = nextVar(context, "a");
      const index = nextVar(context, "i");

      writer.line(`const ${length} = dv.getUint32(o, true); o += 4;`);
      writer.line(`const ${out} = new Set();`);
      writer.line(`for (let ${index} = 0; ${index} < ${length}; ${index}++) {`);
      writer.indent(() => {
        writer.line(`${out}.add(${emitRead(context, element)});`);
      });
      writer.line("}");
      return out;
    }
    case TypeName.map: {
      const keySchema = schema.def.key as ATS.AnyTypeSchema;
      const valueSchema = schema.def.value as ATS.AnyTypeSchema;
      const length = nextVar(context, "l");
      const out = nextVar(context, "a");
      const index = nextVar(context, "i");

      writer.line(`const ${length} = dv.getUint32(o, true); o += 4;`);
      writer.line(`const ${out} = new Map();`);
      writer.line(`for (let ${index} = 0; ${index} < ${length}; ${index}++) {`);
      writer.indent(() => {
        const key = nextVar(context, "e");

        writer.line(`const ${key} = ${emitRead(context, keySchema)};`);
        writer.line(`${out}.set(${key}, ${emitRead(context, valueSchema)});`);
      });
      writer.line("}");
      return out;
    }
    case TypeName.record: {
      const valueSchema = schema.def.value as ATS.AnyTypeSchema;
      const length = nextVar(context, "l");
      const out = nextVar(context, "a");
      const index = nextVar(context, "i");

      writer.line(`const ${length} = dv.getUint32(o, true); o += 4;`);
      writer.line(`const ${out} = {};`);
      writer.line(`for (let ${index} = 0; ${index} < ${length}; ${index}++) {`);
      writer.indent(() => {
        const key = emitStringRead(context);

        writer.line(`${out}[${key}] = ${emitRead(context, valueSchema)};`);
      });
      writer.line("}");
      return out;
    }
    case TypeName.union: {
      const options = schema.def.options as readonly ATS.AnyTypeSchema[];
      const tag = nextVar(context, "t");
      const holder = nextVar(context, "r");

      writer.line(`const ${tag} = dv.getUint8(o); o += 1;`);
      writer.line(`let ${holder};`);
      options.forEach((option, position) => {
        writer.line(`${position === 0 ? "if" : "} else if"} (${tag} === ${position}) {`);
        writer.indent(() => {
          writer.line(`${holder} = ${emitRead(context, option)};`);
        });
      });
      writer.line("} else {");
      writer.indent(() => {
        writer.line(`throw new RangeError("jit codec: invalid union tag: " + ${tag});`);
      });
      writer.line("}");
      return holder;
    }
    case TypeName.discriminatedUnion: {
      const tagged = taggedOptions(schema);
      const tag = nextVar(context, "t");
      const holder = nextVar(context, "r");

      writer.line(`const ${tag} = dv.getUint8(o); o += 1;`);
      writer.line(`let ${holder};`);
      tagged.forEach((entry, position) => {
        writer.line(`${position === 0 ? "if" : "} else if"} (${tag} === ${position}) {`);
        writer.indent(() => {
          writer.line(`${holder} = ${emitBaseRead(context, entry.option)};`);
        });
      });
      writer.line("} else {");
      writer.indent(() => {
        writer.line(`throw new RangeError("jit codec: invalid union tag: " + ${tag});`);
      });
      writer.line("}");
      return holder;
    }
    case TypeName.intersection: {
      const options = schema.def.options as readonly ATS.AnyTypeSchema[];
      const entries: string[] = [];

      for (const option of options) {
        const base = resolveCodecWrappers(option).base;

        if (base.type !== TypeName.object) unsupported("intersection of non-object");
        entries.push(...emitObjectEntries(context, base));
      }
      return `{ ${entries.join(", ")} }`;
    }
    default:
      unsupported(schema.type);
  }
}

function hoist(context: CodecContext, expr: string): string {
  if (Parse.isValidIdentifier(expr)) return expr;

  const holder = nextVar(context, "v");

  context.writer.line(`const ${holder} = ${expr};`);
  return holder;
}
