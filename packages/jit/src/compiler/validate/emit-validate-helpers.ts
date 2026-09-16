import type * as ATS from "../../core/ats/index.js";
import { TypeName } from "../../core/ats/index.js";
import { isOpChain } from "../../core/ops.js";
import { emitLiteral } from "../source/literal.js";
import type {
  AnySchema,
  PathRef,
  PipeStep,
  RefineRecord,
  SchemaCheckRecord,
  UnwrappedSchema,
  ValidatorEmitter,
} from "./emit-validate.js";
/**
 * True when the shallow schema guard is already the complete validation for
 * a union option — no checks, refines, defaults, coercions, or transforms.
 */
export function isShallowOption(schema: ATS.AnyTypeSchema): boolean {
  let current = schema as AnySchema;

  while (
    current.type === TypeName.optional ||
    current.type === TypeName.nullable ||
    current.type === TypeName.nullish ||
    current.type === TypeName.brand ||
    current.type === TypeName.readonly ||
    current.type === TypeName.lazy
  ) {
    current =
      current.type === TypeName.lazy ? (current.def.getter as () => AnySchema)() : (current.def.innerType as AnySchema);
  }

  switch (current.type) {
    case TypeName.any:
    case TypeName.unknown:
    case TypeName.void:
    case TypeName.undefined:
    case TypeName.null:
    case TypeName.boolean:
    case TypeName.bigint:
    case TypeName.symbol:
    case TypeName.literal:
    case TypeName.enum:
      return true;
    case TypeName.string:
    case TypeName.number:
      return (((current.def as Record<string, unknown>).checks as readonly unknown[] | undefined) ?? []).length === 0;
    default:
      return false;
  }
}

export function buildTemplateLiteralRegex(parts: readonly (string | ATS.AnyTypeSchema)[]): RegExp {
  return new RegExp(`^${parts.map(templateLiteralPartSource).join("")}$`, "u");
}

export function temporalConstructorName(kind: ATS.TemporalKind): string {
  switch (kind) {
    case "instant":
      return "Instant";
    case "plainDate":
      return "PlainDate";
    case "plainTime":
      return "PlainTime";
    case "plainDateTime":
      return "PlainDateTime";
    case "zonedDateTime":
      return "ZonedDateTime";
    case "plainYearMonth":
      return "PlainYearMonth";
    case "plainMonthDay":
      return "PlainMonthDay";
    case "duration":
      return "Duration";
  }
}

export function templateLiteralPartSource(part: string | ATS.AnyTypeSchema): string {
  return typeof part === "string" ? escapeRegExp(part) : templateLiteralSchemaSource(part);
}

export function templateLiteralSchemaSource(schema: ATS.AnyTypeSchema): string {
  const current = schema as AnySchema;

  switch (current.type) {
    case TypeName.string:
      return "[\\s\\S]*";
    case TypeName.number:
      return "-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?";
    case TypeName.int:
      return "-?(?:0|[1-9]\\d*)";
    case TypeName.boolean:
      return "(?:true|false)";
    case TypeName.bigint:
      return "-?(?:0|[1-9]\\d*)";
    case TypeName.null:
      return "null";
    case TypeName.undefined:
      return "undefined";
    case TypeName.literal:
      return escapeRegExp(String(current.def.value));
    case TypeName.enum: {
      const values = Object.values(current.def.values as Record<string, string | number>);

      return values.length === 0 ? "(?!)" : `(?:${values.map((value) => escapeRegExp(String(value))).join("|")})`;
    }
    case TypeName.union:
    case TypeName.xor:
      return `(?:${(current.def.options as readonly ATS.AnyTypeSchema[])
        .map((option) => templateLiteralSchemaSource(option))
        .join("|")})`;
    case TypeName.optional:
      return `(?:${templateLiteralSchemaSource(current.def.innerType as ATS.AnyTypeSchema)}|undefined)`;
    case TypeName.nullable:
      return `(?:${templateLiteralSchemaSource(current.def.innerType as ATS.AnyTypeSchema)}|null)`;
    case TypeName.nullish:
      return `(?:${templateLiteralSchemaSource(current.def.innerType as ATS.AnyTypeSchema)}|null|undefined)`;
    case TypeName.default:
    case TypeName.brand:
    case TypeName.readonly:
    case TypeName.refine:
    case TypeName.coerce:
    case TypeName.pipe:
    case TypeName.transform:
      return templateLiteralSchemaSource(current.def.innerType as ATS.AnyTypeSchema);
    case TypeName.when:
      return `(?:${templateLiteralSchemaSource(current.def.thenType as ATS.AnyTypeSchema)}|${templateLiteralSchemaSource(current.def.otherwiseType as ATS.AnyTypeSchema)})`;
    case TypeName.lazy:
      return templateLiteralSchemaSource((current.def.getter as () => ATS.AnyTypeSchema)());
    default:
      throw new Error(`templateLiteral cannot compile ${current.type} parts`);
  }
}

export function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

export function rootPath(): PathRef {
  return { kind: "static", source: "[]", segments: [], parts: [] };
}

export function staticChild(path: PathRef, segment: ATS.IssuePathSegment): PathRef {
  const literal = emitLiteral(segment);
  if (path.kind === "static") {
    const segments = [...(path.segments ?? []), segment];

    return {
      kind: "static",
      source: JSON.stringify(segments),
      segments,
      parts: [...(path.parts ?? []), literal],
    };
  }

  if (path.parts !== undefined) return dynamicPath([...path.parts, literal]);
  return { kind: "dynamic", source: `[...${path.source}, ${literal}]` };
}

export function dynamicChild(path: PathRef, indexVar: string): PathRef {
  if (path.parts !== undefined) return dynamicPath([...path.parts, indexVar]);
  return { kind: "dynamic", source: `[...${path.source}, ${indexVar}]` };
}

export function dynamicKeyChild(path: PathRef, keyExpr: string): PathRef {
  if (path.parts !== undefined) return dynamicPath([...path.parts, keyExpr]);
  return { kind: "dynamic", source: `[...${path.source}, ${keyExpr}]` };
}

export function appendIssuePath(path: PathRef, segments: readonly ATS.IssuePathSegment[] | undefined): PathRef {
  if (!segments || segments.length === 0) return path;

  if (path.kind === "static") {
    const next = [...(path.segments ?? []), ...segments];

    return {
      kind: "static",
      source: JSON.stringify(next),
      segments: next,
      parts: next.map((segment) => emitLiteral(segment)),
    };
  }

  if (path.parts !== undefined) {
    return dynamicPath([...path.parts, ...segments.map((segment) => emitLiteral(segment))]);
  }
  return {
    kind: "dynamic",
    source: `[...${path.source}, ...${JSON.stringify(segments)}]`,
  };
}

export function dynamicPath(parts: readonly string[]): PathRef {
  return { kind: "dynamic", source: `[${parts.join(", ")}]`, parts };
}

export function literalTag(option: ATS.AnyTypeSchema, discriminator: string): string | number | undefined {
  const base = unwrapPassthrough(option);

  if (base.type !== TypeName.object) return undefined;

  const prop = (base.def as { props: Record<string, ATS.AnyTypeSchema> }).props[discriminator];

  if (!prop) return undefined;

  const propBase = unwrapPassthrough(prop);

  if (propBase.type !== TypeName.literal) return undefined;

  const literalValue = (propBase.def as { value: unknown }).value;

  return typeof literalValue === "string" || typeof literalValue === "number" ? literalValue : undefined;
}

export function unwrapPassthrough(schema: ATS.AnyTypeSchema): AnySchema {
  let current = schema as AnySchema;

  while (true) {
    switch (current.type) {
      case TypeName.optional:
      case TypeName.nullable:
      case TypeName.nullish:
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
        return current;
    }
  }
}

export function unwrapValidation(schema: ATS.AnyTypeSchema, emitter: ValidatorEmitter): UnwrappedSchema {
  let current = schema as AnySchema;
  let optional = false;
  let nullable = false;
  let defaultValue: UnwrappedSchema["defaultValue"];
  let coerce: string | undefined;
  const refines: RefineRecord[] = [];
  const pipes: PipeStep[] = [];
  let fieldTransforms: Record<string, string> | undefined;
  let materialize: string | undefined;
  let trustedMaterialize = false;
  let assertion: string | undefined;
  let nestedValidation = false;

  while (true) {
    if (current.type === TypeName.optional) {
      optional = true;
      current = current.def.innerType as AnySchema;
      continue;
    }

    if (current.type === TypeName.nullable) {
      nullable = true;
      current = current.def.innerType as AnySchema;
      continue;
    }

    if (current.type === TypeName.nullish) {
      optional = true;
      nullable = true;
      current = current.def.innerType as AnySchema;
      continue;
    }

    if (current.type === TypeName.default) {
      if (emitter.resolveDefaults && !defaultValue) {
        const raw = current.def.defaultValue;

        defaultValue = {
          binding: emitter.bind(raw),
          isFactory: typeof raw === "function",
        };
      }
      current = current.def.innerType as AnySchema;
      continue;
    }

    if (current.type === TypeName.coerce) {
      coerce = coerce ?? emitter.bind(current.def.coercer);
      current = current.def.innerType as AnySchema;
      continue;
    }

    if (current.type === TypeName.refine) {
      // Outer refines run last: collected outside-in, executed inner-first.
      refines.unshift({
        binding: emitter.bind(current.def.predicate),
        ...(typeof current.def.message === "string" ? { message: current.def.message } : {}),
        ...(Array.isArray(current.def.path) ? { path: current.def.path as readonly ATS.IssuePathSegment[] } : {}),
        ...(typeof current.def.when === "function" ? { when: emitter.bind(current.def.when) } : {}),
      });
      current = current.def.innerType as AnySchema;
      continue;
    }

    if (current.type === TypeName.pipe) {
      const transform = current.def.transform;

      pipes.unshift(
        isOpChain(transform) ? { kind: "inline", chain: transform } : { kind: "call", binding: emitter.bind(transform) }
      );
      current = current.def.innerType as AnySchema;
      continue;
    }

    if (current.type === TypeName.transform) {
      fieldTransforms = fieldTransforms ?? bindFieldTransforms(current.def.transforms, emitter);
      current = current.def.innerType as AnySchema;
      continue;
    }

    if (current.type === TypeName.brand || current.type === TypeName.readonly) {
      current = current.def.innerType as AnySchema;
      continue;
    }

    if (current.type === TypeName.lazy) {
      current = (current.def.getter as () => AnySchema)();
      continue;
    }

    if (current.type === TypeName.runtimeType) {
      const traits = current.def.traits as ATS.RuntimeTypeTraits;
      nestedValidation ||= traits.factoryPolicy.validationConfigured === true;
      if (emitter.materializeRuntimeTypes) {
        materialize = emitter.bind(current.def.materialize);
        trustedMaterialize =
          typeof current.def.materialize === "function" &&
          typeof (current.def.materialize as { readonly __jitMaterialize?: unknown }).__jitMaterialize === "function";
      }
      if (current.def.assertion !== undefined) {
        assertion = emitter.bind(current.def.assertion);
        nestedValidation = true;
      }
      current = current.def.innerType as AnySchema;
      continue;
    }

    break;
  }

  return {
    base: current,
    optional,
    nullable,
    defaultValue,
    emptyAsUndefined: hasNoEmptyCheck(current),
    coerce,
    refines,
    pipes,
    fieldTransforms,
    materialize,
    trustedMaterialize,
    assertion,
    nestedValidation,
  };
}

export function bindFieldTransforms(spec: unknown, emitter: ValidatorEmitter): Record<string, string> {
  const bindings: Record<string, string> = {};

  for (const [key, fn] of Object.entries(spec as Record<string, unknown>)) {
    if (typeof fn === "function") bindings[key] = emitter.bind(fn);
  }

  return bindings;
}

export function hasNoEmptyCheck(schema: AnySchema): boolean {
  if (schema.type !== TypeName.string) return false;

  const checks = (schema.def.checks as readonly SchemaCheckRecord[] | undefined) ?? [];

  return checks.some((check) => check.kind === "noEmpty");
}

/** True when parse output can differ from the input for this subtree. */
export function needsBuild(schema: ATS.AnyTypeSchema): boolean {
  const current = schema as AnySchema;

  switch (current.type) {
    case TypeName.default:
    case TypeName.coerce:
    case TypeName.pipe:
    case TypeName.transform:
    // parseAsync settles promise wrappers, so the output always differs.
    case TypeName.promise:
    case TypeName.codec:
    case TypeName.runtimeType:
      return true;
    case TypeName.when:
      return (
        needsBuild(current.def.thenType as ATS.AnyTypeSchema) ||
        needsBuild(current.def.otherwiseType as ATS.AnyTypeSchema)
      );
    case TypeName.not:
      return false;
    case TypeName.optional:
    case TypeName.nullable:
    case TypeName.nullish:
    case TypeName.brand:
    case TypeName.readonly:
    case TypeName.refine:
      return needsBuild((current.def as { innerType: ATS.AnyTypeSchema }).innerType);
    case TypeName.string: {
      const checks = (current.def.checks as readonly SchemaCheckRecord[] | undefined) ?? [];

      if ((current.def as { coerce?: boolean }).coerce === true) return true;
      return checks.some(
        (check) =>
          check.kind === "trim" ||
          check.kind === "lowercase" ||
          check.kind === "uppercase" ||
          check.kind === "sanitize" ||
          check.kind === "noEmpty" ||
          check.kind === "format" ||
          check.kind === "phoneBR"
      );
    }
    case TypeName.number:
    case TypeName.int:
    case TypeName.boolean:
    case TypeName.bigint:
    case TypeName.date:
      return (current.def as { coerce?: boolean }).coerce === true;
    case TypeName.array:
    case TypeName.set:
      return needsBuild(current.def.element as ATS.AnyTypeSchema);
    case TypeName.map:
      return needsBuild(current.def.key as ATS.AnyTypeSchema) || needsBuild(current.def.value as ATS.AnyTypeSchema);
    case TypeName.union:
    case TypeName.xor:
    case TypeName.discriminatedUnion:
    case TypeName.intersection:
      return (current.def.options as readonly ATS.AnyTypeSchema[]).some(needsBuild);
    case TypeName.tuple: {
      const items = (current.def.items as readonly ATS.AnyTypeSchema[] | undefined) ?? [];
      const rest = current.def.rest as ATS.AnyTypeSchema | undefined;

      return items.some(needsBuild) || (rest !== undefined && needsBuild(rest));
    }
    case TypeName.record:
      return needsBuild(current.def.value as ATS.AnyTypeSchema);
    case TypeName.object: {
      const props = current.def.props as Readonly<Record<string, ATS.AnyTypeSchema>>;
      const catchall = current.def.catchall as ATS.AnyTypeSchema | undefined;

      if ((current.def.unknownKeys as string | undefined) === "strip") return true;
      if (catchall !== undefined && needsBuild(catchall)) return true;
      return Object.keys(props).some((key) => needsBuild(props[key]));
    }
    default:
      return false;
  }
}
