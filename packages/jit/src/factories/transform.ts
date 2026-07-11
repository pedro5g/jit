import { resolveWrappers } from "../compiler/resolvers/resolve-wrappers.js";
import { emitPropertyAccess } from "../compiler/source/access.js";
import { emitLiteral } from "../compiler/source/literal.js";
import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";

type FieldTransform<TValue, TSource> = (value: TValue, source: TSource) => unknown;
type TransformStep<TSource> =
  | { readonly kind: "inline"; readonly emit: (valueExpr: string) => string }
  | { readonly kind: "binding"; readonly fn: FieldTransform<unknown, TSource> };
type TransformMap<TSource> = Partial<{ readonly [TKey in keyof TSource]: TransformStep<TSource> }>;
type TransformKeys<TOutput> = Extract<keyof TOutput, string>;
type TransformMapped<TOutput, TKey extends keyof TOutput, TValue> = Omit<TOutput, TKey> & {
  readonly [TField in TKey]: TValue;
};

export interface TransformExpression<TInput, TOutput> {
  readonly __jitTransformExpression: true;
  readonly emit: (valueExpr: string) => string;
  readonly _input: TInput;
  readonly _output: TOutput;
}

export type TransformFieldOps<TValue> = TValue extends string
  ? {
      lowercase(): TransformExpression<string, string>;
      uppercase(): TransformExpression<string, string>;
      trim(): TransformExpression<string, string>;
    }
  : {
      identity(): TransformExpression<TValue, TValue>;
    };

type TransformMapperResult<TValue, TSource, TResult> =
  | TransformExpression<TValue, TResult>
  | ((value: TValue, source: TSource) => TResult);

export interface TransformBuilder<TSource, TOutput> {
  select<const TKeys extends readonly TransformKeys<TOutput>[]>(
    ...keys: TKeys
  ): TransformBuilder<TSource, Pick<TOutput, TKeys[number]>>;
  map<TKey extends TransformKeys<TOutput>, TResult>(
    key: TKey,
    mapper: (field: TransformFieldOps<TOutput[TKey]>) => TransformMapperResult<TOutput[TKey], TSource, TResult>
  ): TransformBuilder<TSource, TransformMapped<TOutput, TKey, TResult>>;
  compile(): (value: TSource) => TOutput;
}

interface TransformState<TSource> {
  readonly selected: readonly string[] | undefined;
  readonly transforms: TransformMap<TSource>;
}

export function transform<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): TransformBuilder<ATS.InferSchema<TSchema>, ATS.InferSchema<TSchema>> {
  const unwrapped = unwrapSchema(schema);

  return createTransformBuilder(unwrapped, { selected: undefined, transforms: {} });
}

function createTransformBuilder<TSchema extends ATS.AnyTypeSchema, TOutput>(
  schema: TSchema,
  state: TransformState<ATS.InferSchema<TSchema>>
): TransformBuilder<ATS.InferSchema<TSchema>, TOutput> {
  return {
    select(...keys) {
      return createTransformBuilder(schema, { ...state, selected: keys });
    },
    map(key, mapper) {
      const result = mapper(createFieldOps());
      const step: TransformStep<ATS.InferSchema<TSchema>> = isTransformExpression(result)
        ? { kind: "inline", emit: result.emit }
        : { kind: "binding", fn: result as FieldTransform<unknown, ATS.InferSchema<TSchema>> };
      const transforms = { ...state.transforms, [key]: step };

      return createTransformBuilder(schema, { ...state, transforms });
    },
    compile() {
      return compileTransformFacade(schema, state) as (value: ATS.InferSchema<TSchema>) => TOutput;
    },
  };
}

function compileTransformFacade<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  state: TransformState<ATS.InferSchema<TSchema>>
): (value: ATS.InferSchema<TSchema>) => unknown {
  const objectSchema = resolveWrappers(schema).base;

  if (objectSchema.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", "JIT.transform expects an object schema");
  }

  const props = (objectSchema as ATS.ObjectSchema<ATS.SchemaShape>).def.props;
  const keys = state.selected ?? Object.keys(props);

  for (const key of keys) {
    if (!(key in props))
      throw new JITError("INVALID_OPERATION", `transform selected unknown key ${JSON.stringify(key)}`);
  }
  for (const key of Object.keys(state.transforms)) {
    if (!(key in props)) throw new JITError("INVALID_OPERATION", `transform mapped unknown key ${JSON.stringify(key)}`);
  }

  const transformKeys = Object.keys(state.transforms);
  const bindings = collectBindings(transformKeys, state.transforms);
  const source = emitTransformFacadeSource(keys, state.transforms, bindings.namesByKey);
  const fn = globalThis.Function(...bindings.names, `return ${source};`)(...bindings.values) as (
    value: ATS.InferSchema<TSchema>
  ) => unknown;

  registerArtifact(fn as object, {
    kind: "mapper",
    source,
    bindingNames: bindings.names,
    bindingValues: bindings.values,
  });
  return fn;
}

function emitTransformFacadeSource(
  keys: readonly string[],
  transforms: Readonly<Record<string, TransformStep<unknown> | undefined>>,
  bindingNamesByKey: ReadonlyMap<string, string>
): string {
  const entries = keys.map((key) => {
    const source = emitPropertyAccess("value", key);
    const transform = transforms[key as keyof typeof transforms];
    const bindingName = bindingNamesByKey.get(key);
    const value =
      transform?.kind === "inline" ? transform.emit(source) : bindingName ? `${bindingName}(${source}, value)` : source;

    return `${emitLiteral(key)}: ${value}`;
  });

  return `function transform(value) {\n  return { ${entries.join(", ")} };\n}`;
}

function createFieldOps<TValue>(): TransformFieldOps<TValue> {
  return {
    lowercase: () => transformExpression<string, string>((valueExpr) => `${valueExpr}.toLowerCase()`),
    uppercase: () => transformExpression<string, string>((valueExpr) => `${valueExpr}.toUpperCase()`),
    trim: () => transformExpression<string, string>((valueExpr) => `${valueExpr}.trim()`),
    identity: () => transformExpression<TValue, TValue>((valueExpr) => valueExpr),
  } as unknown as TransformFieldOps<TValue>;
}

function transformExpression<TInput, TOutput>(
  emit: (valueExpr: string) => string
): TransformExpression<TInput, TOutput> {
  return {
    __jitTransformExpression: true,
    emit,
    _input: null as TInput,
    _output: null as TOutput,
  };
}

function isTransformExpression(value: unknown): value is TransformExpression<unknown, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { readonly __jitTransformExpression?: unknown }).__jitTransformExpression === true
  );
}

function collectBindings<TSource>(
  keys: readonly string[],
  transforms: TransformMap<TSource>
): {
  readonly names: readonly string[];
  readonly values: readonly FieldTransform<unknown, TSource>[];
  readonly namesByKey: ReadonlyMap<string, string>;
} {
  const names: string[] = [];
  const values: FieldTransform<unknown, TSource>[] = [];
  const namesByKey = new Map<string, string>();

  for (const key of keys) {
    const transform = transforms[key as keyof typeof transforms];

    if (transform?.kind !== "binding") continue;

    const name = `__t${names.length}`;

    names[names.length] = name;
    values[values.length] = transform.fn;
    namesByKey.set(key, name);
  }

  return { names, values, namesByKey };
}
