import { type ChangeLayout, resolveChangeLayout } from "../compiler/change-layout.js";
import {
  type DerivedDescriptor,
  derivedCacheKey,
  derivedEqualBindings,
  emitDerivedMemoSource,
  emitDerivedSource,
  resolveDerivedDescriptor,
} from "../compiler/derive.js";
import type { AnyTypeSchema, TypeofSchema } from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";

/** Nested paths a derived computation may read, one level of nesting deep. */
type DerivablePath<TState> = Extract<keyof TState, string> | NestedPath<TState>;
type NestedPath<TState> = {
  [TKey in Extract<keyof TState, string>]: TState[TKey] extends Record<string, unknown>
    ? `${TKey}.${Extract<keyof TState[TKey], string>}`
    : never;
}[Extract<keyof TState, string>];

type LeafKey<TPath extends string> = TPath extends `${string}.${infer TRest}` ? LeafKey<TRest> : TPath;
type Derived<TState, TPaths extends readonly string[]> = {
  readonly [TPath in TPaths[number] as LeafKey<TPath>]: PathValue<TState, TPath>;
};
type PathValue<TState, TPath extends string> = TPath extends `${infer THead}.${infer TRest}`
  ? THead extends keyof TState
    ? PathValue<TState[THead], TRest>
    : never
  : TPath extends keyof TState
    ? TState[TPath]
    : never;

export interface DerivedExplanation {
  /** Fields the computation reads, in the order it reads them. */
  readonly reads: readonly string[];
  readonly layout: ChangeLayout;
  /** Bits of the layout the computation depends on. */
  readonly mask: number | bigint;
}

/**
 * A derived computation, and the memoized selector it can produce.
 *
 * @template TState - The state the computation reads from.
 * @template TResult - The value it derives.
 */
export interface DerivedComputation<TState, TResult> {
  (state: TState): TResult;
  /**
   * A selector that recomputes only when a field it reads changed.
   *
   * The optional second argument is a change mask, normally the `changed`
   * channel of a mutation result. It is a plain number, so it carries no proof
   * of where it came from: compare `layout().id` before trusting one from a
   * different artifact.
   */
  memo(): ((state: TState, mask?: number | bigint) => TResult) & {
    layout(): ChangeLayout;
    accepts(layout: ChangeLayout): boolean;
  };
  explain(): DerivedExplanation;
  layout(): ChangeLayout;
}

export interface DerivedBuilder<TState> {
  /** Declares the fields the computation reads; they become its dependencies. */
  select<const TPaths extends readonly DerivablePath<TState>[]>(
    ...paths: TPaths
  ): DerivedComputation<TState, Derived<TState, TPaths>>;
}

/**
 * Opens a derived computation over one state schema.
 *
 * Traditional memoization asks whether the input reference changed. A derived
 * computation knows which fields it reads, so it can ask the narrower question:
 * did anything it reads change? An unrelated mutation does not recompute it,
 * and it never compares the whole state.
 *
 * @param schema - The state schema the computation reads from.
 * @param options - `layout` fixes the path-to-bit agreement masks are read in.
 */
export function derive<TSchema extends AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  options?: { readonly layout?: ChangeLayout }
): DerivedBuilder<TypeofSchema<TSchema>> {
  const unwrapped = unwrapSchema(schema);
  const layout = options?.layout ?? resolveChangeLayout(unwrapped);

  return Object.freeze({
    select: (...paths: readonly string[]) => createDerived(unwrapped, paths, layout),
  }) as unknown as DerivedBuilder<TypeofSchema<TSchema>>;
}

function createDerived<TState, TResult>(
  schema: AnyTypeSchema,
  paths: readonly string[],
  layout: ChangeLayout
): DerivedComputation<TState, TResult> {
  const descriptor = resolveDerivedDescriptor(schema, paths, layout);
  const explanation: DerivedExplanation = Object.freeze({
    reads: Object.freeze(descriptor.dependencies.map((dependency) => dependency.path)),
    layout,
    mask: descriptor.mask,
  });
  const select = compileDerived<TState, TResult>(schema, descriptor, false) as DerivedComputation<TState, TResult>;

  Object.defineProperties(select, {
    explain: { enumerable: false, value: () => explanation },
    layout: { enumerable: false, value: () => layout },
    memo: {
      enumerable: false,
      value: () => {
        const memo = compileDerived<TState, TResult>(schema, descriptor, true) as ((
          state: TState,
          mask?: number | bigint
        ) => TResult) & { layout(): ChangeLayout; accepts(other: ChangeLayout): boolean };

        Object.defineProperties(memo, {
          layout: { enumerable: false, value: () => layout },
          accepts: { enumerable: false, value: (other: ChangeLayout) => other.id === layout.id },
        });
        return memo;
      },
    },
  });
  return select;
}

function compileDerived<TState, TResult>(
  schema: AnyTypeSchema,
  descriptor: DerivedDescriptor,
  memo: boolean
): (state: TState, mask?: number | bigint) => TResult {
  const bindings = derivedEqualBindings(descriptor);
  const source = memo ? emitDerivedMemoSource(descriptor) : emitDerivedSource(descriptor);
  const compiled = globalThis.Function(
    ...bindings.map((binding) => binding.name),
    memo ? `return ${source};` : `${source}\nreturn select;`
  )(...bindings.map((binding) => globalThis.Function(`return ${binding.source};`)())) as (
    state: TState,
    mask?: number | bigint
  ) => TResult;

  registerArtifact(compiled as object, {
    kind: "derived-plan",
    schema,
    source,
    memo,
    equalSources: bindings.map((binding) => ({ name: binding.name, source: binding.source })),
    layout: descriptor.layout,
    reads: descriptor.dependencies.map((dependency) => dependency.path),
    cacheKey: derivedCacheKey(descriptor, memo),
  });
  return compiled;
}
