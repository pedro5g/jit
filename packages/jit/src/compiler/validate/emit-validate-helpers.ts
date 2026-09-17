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

  while (SHALLOW_WRAPPERS.has(current.type)) {
    current =
      current.type === TypeName.lazy ? (current.def.getter as () => AnySchema)() : (current.def.innerType as AnySchema);
  }

  if (SHALLOW_LEAVES.has(current.type)) return true;
  if (current.type === TypeName.string || current.type === TypeName.number)
    return (((current.def as Record<string, unknown>).checks as readonly unknown[] | undefined) ?? []).length === 0;
  return false;
}

const SHALLOW_WRAPPERS: ReadonlySet<string> = new Set([
  TypeName.optional,
  TypeName.nullable,
  TypeName.nullish,
  TypeName.brand,
  TypeName.readonly,
  TypeName.lazy,
]);

const SHALLOW_LEAVES: ReadonlySet<string> = new Set([
  TypeName.any,
  TypeName.unknown,
  TypeName.void,
  TypeName.undefined,
  TypeName.null,
  TypeName.boolean,
  TypeName.bigint,
  TypeName.symbol,
  TypeName.literal,
  TypeName.enum,
]);

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

type TemplateLiteralSchemaEmitter = (schema: AnySchema) => string;

const TEMPLATE_LITERAL_EMITTERS: Readonly<Record<string, TemplateLiteralSchemaEmitter>> = {
  [TypeName.string]: () => "[\\s\\S]*",
  [TypeName.number]: () => "-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?",
  [TypeName.int]: () => "-?(?:0|[1-9]\\d*)",
  [TypeName.boolean]: () => "(?:true|false)",
  [TypeName.bigint]: () => "-?(?:0|[1-9]\\d*)",
  [TypeName.null]: () => "null",
  [TypeName.undefined]: () => "undefined",
  [TypeName.literal]: (schema) => escapeRegExp(String(schema.def.value)),
  [TypeName.enum]: (schema) => {
    const values = Object.values(schema.def.values as Record<string, string | number>);
    return values.length === 0 ? "(?!)" : `(?:${values.map((value) => escapeRegExp(String(value))).join("|")})`;
  },
  [TypeName.union]: emitTemplateLiteralUnion,
  [TypeName.xor]: emitTemplateLiteralUnion,
  [TypeName.optional]: (schema) =>
    `(?:${templateLiteralSchemaSource(schema.def.innerType as ATS.AnyTypeSchema)}|undefined)`,
  [TypeName.nullable]: (schema) => `(?:${templateLiteralSchemaSource(schema.def.innerType as ATS.AnyTypeSchema)}|null)`,
  [TypeName.nullish]: (schema) =>
    `(?:${templateLiteralSchemaSource(schema.def.innerType as ATS.AnyTypeSchema)}|null|undefined)`,
  [TypeName.default]: emitTemplateLiteralInner,
  [TypeName.brand]: emitTemplateLiteralInner,
  [TypeName.readonly]: emitTemplateLiteralInner,
  [TypeName.refine]: emitTemplateLiteralInner,
  [TypeName.coerce]: emitTemplateLiteralInner,
  [TypeName.pipe]: emitTemplateLiteralInner,
  [TypeName.transform]: emitTemplateLiteralInner,
  [TypeName.when]: (schema) =>
    `(?:${templateLiteralSchemaSource(schema.def.thenType as ATS.AnyTypeSchema)}|${templateLiteralSchemaSource(schema.def.otherwiseType as ATS.AnyTypeSchema)})`,
  [TypeName.lazy]: (schema) => templateLiteralSchemaSource((schema.def.getter as () => ATS.AnyTypeSchema)()),
};

export function templateLiteralSchemaSource(schema: ATS.AnyTypeSchema): string {
  const current = schema as AnySchema;
  const emitter = TEMPLATE_LITERAL_EMITTERS[current.type];
  if (emitter !== undefined) return emitter(current);
  throw new Error(`templateLiteral cannot compile ${current.type} parts`);
}

function emitTemplateLiteralUnion(schema: AnySchema): string {
  return `(?:${(schema.def.options as readonly ATS.AnyTypeSchema[])
    .map((option) => templateLiteralSchemaSource(option))
    .join("|")})`;
}

function emitTemplateLiteralInner(schema: AnySchema): string {
  return templateLiteralSchemaSource(schema.def.innerType as ATS.AnyTypeSchema);
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

interface ValidationUnwrapState {
  optional: boolean;
  nullable: boolean;
  defaultValue: UnwrappedSchema["defaultValue"];
  coerce: string | undefined;
  refines: RefineRecord[];
  pipes: PipeStep[];
  fieldTransforms: Record<string, string> | undefined;
  materialize: string | undefined;
  trustedMaterialize: boolean;
  assertion: string | undefined;
  nestedValidation: boolean;
}

type ValidationUnwrapper = (schema: AnySchema, emitter: ValidatorEmitter, state: ValidationUnwrapState) => AnySchema;

const VALIDATION_UNWRAPPERS: Readonly<Record<string, ValidationUnwrapper>> = {
  [TypeName.optional]: unwrapOptional,
  [TypeName.nullable]: unwrapNullable,
  [TypeName.nullish]: unwrapNullish,
  [TypeName.default]: unwrapDefault,
  [TypeName.coerce]: unwrapCoerce,
  [TypeName.refine]: unwrapRefine,
  [TypeName.pipe]: unwrapPipe,
  [TypeName.transform]: unwrapTransform,
  [TypeName.brand]: unwrapInner,
  [TypeName.readonly]: unwrapInner,
  [TypeName.lazy]: unwrapLazy,
  [TypeName.runtimeType]: unwrapRuntimeType,
};

export function unwrapValidation(schema: ATS.AnyTypeSchema, emitter: ValidatorEmitter): UnwrappedSchema {
  let current = schema as AnySchema;
  const state: ValidationUnwrapState = {
    optional: false,
    nullable: false,
    defaultValue: undefined,
    coerce: undefined,
    refines: [],
    pipes: [],
    fieldTransforms: undefined,
    materialize: undefined,
    trustedMaterialize: false,
    assertion: undefined,
    nestedValidation: false,
  };

  while (true) {
    const unwrap = VALIDATION_UNWRAPPERS[current.type];
    if (unwrap === undefined) break;
    current = unwrap(current, emitter, state);
  }

  return {
    base: current,
    optional: state.optional,
    nullable: state.nullable,
    defaultValue: state.defaultValue,
    emptyAsUndefined: hasNoEmptyCheck(current),
    coerce: state.coerce,
    refines: state.refines,
    pipes: state.pipes,
    fieldTransforms: state.fieldTransforms,
    materialize: state.materialize,
    trustedMaterialize: state.trustedMaterialize,
    assertion: state.assertion,
    nestedValidation: state.nestedValidation,
  };
}

function unwrapOptional(schema: AnySchema, _emitter: ValidatorEmitter, state: ValidationUnwrapState): AnySchema {
  state.optional = true;
  return schema.def.innerType as AnySchema;
}

function unwrapNullable(schema: AnySchema, _emitter: ValidatorEmitter, state: ValidationUnwrapState): AnySchema {
  state.nullable = true;
  return schema.def.innerType as AnySchema;
}

function unwrapNullish(schema: AnySchema, _emitter: ValidatorEmitter, state: ValidationUnwrapState): AnySchema {
  state.optional = true;
  state.nullable = true;
  return schema.def.innerType as AnySchema;
}

function unwrapDefault(schema: AnySchema, emitter: ValidatorEmitter, state: ValidationUnwrapState): AnySchema {
  if (emitter.resolveDefaults && state.defaultValue === undefined) {
    const raw = schema.def.defaultValue;
    state.defaultValue = { binding: emitter.bind(raw), isFactory: typeof raw === "function" };
  }
  return schema.def.innerType as AnySchema;
}

function unwrapCoerce(schema: AnySchema, emitter: ValidatorEmitter, state: ValidationUnwrapState): AnySchema {
  state.coerce ??= emitter.bind(schema.def.coercer);
  return schema.def.innerType as AnySchema;
}

function unwrapRefine(schema: AnySchema, emitter: ValidatorEmitter, state: ValidationUnwrapState): AnySchema {
  state.refines.unshift({
    binding: emitter.bind(schema.def.predicate),
    ...(typeof schema.def.message === "string" ? { message: schema.def.message } : {}),
    ...(Array.isArray(schema.def.path) ? { path: schema.def.path as readonly ATS.IssuePathSegment[] } : {}),
    ...(typeof schema.def.when === "function" ? { when: emitter.bind(schema.def.when) } : {}),
  });
  return schema.def.innerType as AnySchema;
}

function unwrapPipe(schema: AnySchema, emitter: ValidatorEmitter, state: ValidationUnwrapState): AnySchema {
  const transform = schema.def.transform;
  state.pipes.unshift(
    isOpChain(transform) ? { kind: "inline", chain: transform } : { kind: "call", binding: emitter.bind(transform) }
  );
  return schema.def.innerType as AnySchema;
}

function unwrapTransform(schema: AnySchema, emitter: ValidatorEmitter, state: ValidationUnwrapState): AnySchema {
  state.fieldTransforms ??= bindFieldTransforms(schema.def.transforms, emitter);
  return schema.def.innerType as AnySchema;
}

function unwrapInner(schema: AnySchema, _emitter: ValidatorEmitter, _state: ValidationUnwrapState): AnySchema {
  return schema.def.innerType as AnySchema;
}

function unwrapLazy(schema: AnySchema, _emitter: ValidatorEmitter, _state: ValidationUnwrapState): AnySchema {
  return (schema.def.getter as () => AnySchema)();
}

function unwrapRuntimeType(schema: AnySchema, emitter: ValidatorEmitter, state: ValidationUnwrapState): AnySchema {
  const traits = schema.def.traits as ATS.RuntimeTypeTraits;
  state.nestedValidation ||= traits.factoryPolicy.validationConfigured === true;
  if (emitter.materializeRuntimeTypes) {
    state.materialize = emitter.bind(schema.def.materialize);
    state.trustedMaterialize =
      typeof schema.def.materialize === "function" &&
      typeof (schema.def.materialize as { readonly __jitMaterialize?: unknown }).__jitMaterialize === "function";
  }
  if (schema.def.assertion !== undefined) {
    state.assertion = emitter.bind(schema.def.assertion);
    state.nestedValidation = true;
  }
  return schema.def.innerType as AnySchema;
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
type BuildDecision = (schema: AnySchema) => boolean;

const BUILD_DECISIONS: Readonly<Record<string, BuildDecision>> = {
  [TypeName.default]: alwaysBuild,
  [TypeName.coerce]: alwaysBuild,
  [TypeName.pipe]: alwaysBuild,
  [TypeName.transform]: alwaysBuild,
  [TypeName.promise]: alwaysBuild,
  [TypeName.codec]: alwaysBuild,
  [TypeName.runtimeType]: alwaysBuild,
  [TypeName.when]: needsBuildWhen,
  [TypeName.not]: () => false,
  [TypeName.optional]: needsBuildInner,
  [TypeName.nullable]: needsBuildInner,
  [TypeName.nullish]: needsBuildInner,
  [TypeName.brand]: needsBuildInner,
  [TypeName.readonly]: needsBuildInner,
  [TypeName.refine]: needsBuildInner,
  [TypeName.string]: needsBuildString,
  [TypeName.number]: needsBuildCoerce,
  [TypeName.int]: needsBuildCoerce,
  [TypeName.boolean]: needsBuildCoerce,
  [TypeName.bigint]: needsBuildCoerce,
  [TypeName.date]: needsBuildCoerce,
  [TypeName.array]: needsBuildElement,
  [TypeName.set]: needsBuildElement,
  [TypeName.map]: needsBuildMap,
  [TypeName.union]: needsBuildOptions,
  [TypeName.xor]: needsBuildOptions,
  [TypeName.discriminatedUnion]: needsBuildOptions,
  [TypeName.intersection]: needsBuildOptions,
  [TypeName.tuple]: needsBuildTuple,
  [TypeName.record]: needsBuildValue,
  [TypeName.object]: needsBuildObject,
};

export function needsBuild(schema: ATS.AnyTypeSchema): boolean {
  const current = schema as AnySchema;
  return BUILD_DECISIONS[current.type]?.(current) ?? false;
}

function alwaysBuild(_schema: AnySchema): boolean {
  return true;
}

function needsBuildWhen(schema: AnySchema): boolean {
  return (
    needsBuild(schema.def.thenType as ATS.AnyTypeSchema) || needsBuild(schema.def.otherwiseType as ATS.AnyTypeSchema)
  );
}

function needsBuildInner(schema: AnySchema): boolean {
  return needsBuild((schema.def as { innerType: ATS.AnyTypeSchema }).innerType);
}

function needsBuildString(schema: AnySchema): boolean {
  const checks = (schema.def.checks as readonly SchemaCheckRecord[] | undefined) ?? [];
  if ((schema.def as { coerce?: boolean }).coerce === true) return true;
  return checks.some((check) =>
    ["trim", "lowercase", "uppercase", "sanitize", "noEmpty", "format", "phoneBR"].includes(check.kind)
  );
}

function needsBuildCoerce(schema: AnySchema): boolean {
  return (schema.def as { coerce?: boolean }).coerce === true;
}

function needsBuildElement(schema: AnySchema): boolean {
  return needsBuild(schema.def.element as ATS.AnyTypeSchema);
}

function needsBuildMap(schema: AnySchema): boolean {
  return needsBuild(schema.def.key as ATS.AnyTypeSchema) || needsBuild(schema.def.value as ATS.AnyTypeSchema);
}

function needsBuildOptions(schema: AnySchema): boolean {
  return (schema.def.options as readonly ATS.AnyTypeSchema[]).some(needsBuild);
}

function needsBuildTuple(schema: AnySchema): boolean {
  const items = (schema.def.items as readonly ATS.AnyTypeSchema[] | undefined) ?? [];
  const rest = schema.def.rest as ATS.AnyTypeSchema | undefined;
  return items.some(needsBuild) || (rest !== undefined && needsBuild(rest));
}

function needsBuildValue(schema: AnySchema): boolean {
  return needsBuild(schema.def.value as ATS.AnyTypeSchema);
}

function needsBuildObject(schema: AnySchema): boolean {
  const props = schema.def.props as Readonly<Record<string, ATS.AnyTypeSchema>>;
  const catchall = schema.def.catchall as ATS.AnyTypeSchema | undefined;
  if ((schema.def.unknownKeys as string | undefined) === "strip") return true;
  if (catchall !== undefined && needsBuild(catchall)) return true;
  return Object.keys(props).some((key) => needsBuild(props[key]));
}
