import { compileAccessMutationGuard, resolveAccessContext } from "../compiler/access.js";
import { type ChangeLayout, resolveChangeLayout } from "../compiler/change-layout.js";
import { compileDiff, type Diff } from "../compiler/diff.js";
import {
  buildMutationPlan,
  emitMutationBody,
  isSpecializableMutation,
  type MutationChannels,
  type MutationOutputs,
  type MutationPlan,
  type MutationWriteInput,
} from "../compiler/mutation/index.js";
import { resolveWrappers } from "../compiler/resolvers/resolve-wrappers.js";
import { compileUpdate, type UpdatePatch } from "../compiler/update.js";
import type { AnyTypeSchema, InnerTypeDef, LazyDef, ObjectDef, TypeofSchema } from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import {
  createReactiveUpdate,
  type ReactiveUpdateController,
  type ReactiveUpdateOptions,
} from "../runtime/update/index.js";
import type { Ability, AccessPlan } from "./access.js";
import type { QueryParamRef } from "./query.js";

export type ReactiveUpdate<T> = ReactiveUpdateController<T, UpdateInput<T>>;
export type {
  ReactiveChange,
  ReactivePath,
  ReactivePathEvent,
  ReactivePathValue,
  ReactiveScheduler,
  ReactiveSelectionEvent,
  ReactiveSubscribeOptions,
  ReactiveUpdateEvent,
  ReactiveUpdateOptions,
  ReactiveWatchOptions,
} from "../runtime/update/index.js";

/**
 * Mutable draft shape accepted by update recipes.
 *
 * @template T - The value type being updated.
 */
export type Draft<T> = T extends readonly (infer TItem)[]
  ? Draft<TItem>[]
  : T extends Date
    ? T
    : T extends Set<unknown>
      ? T
      : T extends Map<unknown, unknown>
        ? T
        : T extends object
          ? { -readonly [TKey in keyof T]: Draft<T[TKey]> }
          : T;

/**
 * Recipe callback that records writes against a draft proxy.
 *
 * @template T - The value type being updated.
 * @param draft - The mutable draft proxy.
 * @returns Nothing; writes are captured as an update patch.
 */
export type UpdateRecipe<T> = (draft: Draft<T>) => void;
/**
 * Runtime update input: either a structural patch or a draft recipe.
 *
 * @template T - The value type being updated.
 */
export type UpdateInput<T> = UpdatePatch<T> | UpdateRecipe<T>;
/**
 * Runtime update function returned by `JIT.state.update(schema)`.
 *
 * @template T - The value type being updated.
 * @param value - The value to update.
 * @param input - A structural patch or draft recipe.
 * @returns The updated value.
 */
export type RuntimeUpdate<T> = ((value: T, input: UpdateInput<T>) => T) & {
  compile(): RuntimeUpdate<T>;
  authorize<TAction extends string, TActor>(
    ability: Ability<T, TAction> | AccessPlan<T, TActor, TAction>,
    action: TAction,
    actor?: TActor
  ): RuntimeUpdate<T>;
  reactive(initial: T, options?: ReactiveUpdateOptions): ReactiveUpdate<T>;
  patch<const TPatch extends UpdatePatchTemplate<T>>(patch: TPatch): CompiledPatch<T, TPatch>;
};

/**
 * A declared patch, before it is compiled.
 *
 * `explain()` reports which paths the mutation reads and writes and whether the
 * planner could specialize it, without compiling anything.
 */
export interface CompiledPatch<T, TPatch> {
  compile(): (value: T, params: UpdatePatchParams<TPatch>) => T;
  explain(): MutationExplanation;
  /**
   * Asks the mutation for more than the new value.
   *
   * The mask, the forward patch and the inverse patch are produced in the same
   * pass, from the comparisons the mutation was already making — not by
   * diffing afterwards. An output nobody asked for is not computed and does
   * not appear in the generated source.
   */
  result<const TChannels extends MutationChannels>(channels: TChannels): CompiledMutation<T, TPatch, TChannels>;
}

export interface CompiledMutation<T, TPatch, TChannels extends MutationChannels> {
  compile(): ((value: T, params: UpdatePatchParams<TPatch>) => MutationResult<T, TChannels>) & {
    /** The path-to-bit agreement the mask was produced against. */
    layout(): ChangeLayout | undefined;
  };
  explain(): MutationExplanation;
}

export type MutationResult<T, TChannels extends MutationChannels> = {
  readonly value: T;
} & (TChannels["changed"] extends undefined | false ? Record<never, never> : { readonly changed: number | bigint }) &
  (TChannels["patch"] extends true ? { readonly patch: UpdatePatch<T> | undefined } : Record<never, never>) &
  (TChannels["inverse"] extends true ? { readonly inverse: UpdatePatch<T> | undefined } : Record<never, never>);

export interface MutationExplanation {
  /** `"specialized"` rebuilds only the changed levels; `"generic"` runs the deep-partial update. */
  readonly strategy: "specialized" | "generic";
  readonly reads: readonly string[];
  readonly writes: readonly string[];
  readonly params: readonly string[];
}

export type UpdatePatchTemplate<T> = T extends object
  ? {
      readonly [TKey in keyof T]?: UpdatePatchTemplate<T[TKey]> | QueryParamRef<T[TKey]> | T[TKey];
    }
  : T | QueryParamRef<T>;

type UpdatePatchParamNames<TPatch> =
  TPatch extends QueryParamRef<unknown>
    ? TPatch["name"]
    : TPatch extends readonly unknown[]
      ? UpdatePatchParamNames<TPatch[number]>
      : TPatch extends object
        ? {
            [TKey in keyof TPatch]: UpdatePatchParamNames<TPatch[TKey]>;
          }[keyof TPatch]
        : never;

export type UpdatePatchParams<TPatch> = [UpdatePatchParamNames<TPatch>] extends [never]
  ? Readonly<Record<never, never>>
  : Readonly<Record<Extract<UpdatePatchParamNames<TPatch>, string>, unknown>>;

/**
 * Compiles a runtime update function for a schema.
 *
 * @template TSchema - The schema type used for inference.
 * @param schema - The schema or builder used to compile updates.
 * @returns A reusable runtime update function.
 */
export function update<TSchema extends AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): RuntimeUpdate<TypeofSchema<TSchema>>;
/**
 * Applies an update immediately using a schema.
 *
 * @template TSchema - The schema type used for inference.
 * @param schema - The schema or builder used to compile updates.
 * @param value - The value to update.
 * @param input - A structural patch or draft recipe.
 * @returns The updated value.
 */
export function update<TSchema extends AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  value: TypeofSchema<TSchema>,
  input: UpdateInput<TypeofSchema<TSchema>>
): TypeofSchema<TSchema>;
export function update<TSchema extends AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  ...args: [] | [value: TypeofSchema<TSchema>, input: UpdateInput<TypeofSchema<TSchema>>]
): RuntimeUpdate<TypeofSchema<TSchema>> | TypeofSchema<TSchema> {
  const unwrapped = unwrapSchema(schema);

  assertUpdateable(unwrapped);

  const compiled = compileUpdate(unwrapped);
  const run = ((current: TypeofSchema<TSchema>, updateInput: UpdateInput<TypeofSchema<TSchema>>) => {
    const patch =
      typeof updateInput === "function"
        ? captureDraftPatch(updateInput as UpdateRecipe<TypeofSchema<TSchema>>)
        : updateInput;

    return compiled(current, patch);
  }) as RuntimeUpdate<TypeofSchema<TSchema>>;

  installUpdateMethods(run, unwrapped);

  if (args.length === 0) {
    // Registered so `jit generate` sees a standalone update the same way it
    // sees one inside an execution plan, instead of dropping it silently.
    registerArtifact(run as object, { kind: "operation", schema: unwrapped, op: "update" });
    return run;
  }

  return run(args[0], args[1]);
}

function installUpdateMethods<T>(run: RuntimeUpdate<T>, schema: AnyTypeSchema): void {
  Object.defineProperties(run, {
    compile: {
      enumerable: false,
      value: () => run,
    },
    patch: {
      enumerable: false,
      value: (template: UpdatePatchTemplate<T>) => createCompiledPatch(run, schema, template),
    },
    reactive: {
      enumerable: false,
      value: (initial: T, options?: ReactiveUpdateOptions) =>
        createReactiveUpdate(initial, run, () => compileDiff(schema) as Diff<T>, options),
    },
    authorize: {
      enumerable: false,
      value: <TAction extends string, TActor>(
        ability: Ability<T, TAction> | AccessPlan<T, TActor, TAction>,
        action: TAction,
        actor?: TActor
      ) => {
        const context = resolveAccessContext(ability as object, actor);
        if (context === undefined) {
          throw new JITError("INVALID_OPERATION", "update.authorize() requires an ability created by JIT.access()");
        }
        const guard = compileAccessMutationGuard(context, action);
        const authorized = ((current: T, input: UpdateInput<T>) => {
          const patch = typeof input === "function" ? captureDraftPatch(input as UpdateRecipe<T>) : input;
          guard(current, patch);
          return run(current, patch as UpdateInput<T>);
        }) as RuntimeUpdate<T>;
        installUpdateMethods(authorized, schema);
        registerArtifact(authorized as object, {
          kind: "authorized-update-plan",
          schema,
          descriptor: context.descriptor,
          actor: context.actor,
          action,
        });
        return authorized;
      },
    },
  });
}

/**
 * Plans one declared patch and compiles the narrowest thing that is correct.
 *
 * When every declared path assigns a leaf the generic update would assign, the
 * mutation becomes one function that reads the written fields, compares, and
 * rebuilds only the levels that changed. Anything the deep-partial update would
 * *merge* rather than assign keeps running through it, so a patch never quietly
 * changes meaning to become faster.
 */
function createCompiledPatch<T, TPatch>(
  run: RuntimeUpdate<T>,
  schema: AnyTypeSchema,
  template: unknown
): CompiledPatch<T, TPatch> {
  const bindings: unknown[] = [];
  const writes = collectPatchWrites(schema, template, [], bindings);
  const specialized =
    writes !== undefined &&
    isSpecializableMutation(
      schema,
      writes.map((write) => write.path)
    );
  const plan = specialized ? buildMutationPlan(schema, writes as MutationWriteInput[], bindings) : undefined;
  const explanation: MutationExplanation = Object.freeze({
    strategy: plan === undefined ? ("generic" as const) : ("specialized" as const),
    reads: Object.freeze((plan?.dependencies.reads ?? []).map((path) => path.join("."))),
    writes: Object.freeze((plan?.dependencies.writes ?? []).map((path) => path.join("."))),
    params: Object.freeze([...(plan?.params ?? [])]),
  });

  return {
    explain: () => explanation,
    result: <const TChannels extends MutationChannels>(channels: TChannels) => {
      if (plan === undefined) {
        throw new JITError(
          "INVALID_UPDATE",
          "result() needs a specialized mutation; explain().strategy reports why this patch stayed generic"
        );
      }
      const outputs = resolveMutationOutputs(schema, channels);
      return {
        explain: () => explanation,
        compile: () => compileMutation<T>(schema, plan, explanation, outputs),
      } as unknown as CompiledMutation<T, TPatch, TChannels>;
    },
    compile: () => {
      if (plan === undefined) {
        return (current: T, params: Readonly<Record<string, unknown>>) =>
          run(current, materializeParamPatch(template, params) as UpdateInput<T>);
      }
      return compileMutation<T>(schema, plan, explanation, {}) as unknown as (
        value: T,
        params: UpdatePatchParams<TPatch>
      ) => T;
    },
  };
}

/** Resolves the requested channels into the layout and flags the emitter needs. */
function resolveMutationOutputs(schema: AnyTypeSchema, channels: MutationChannels): MutationOutputs {
  const changed =
    channels.changed === undefined || channels.changed === false
      ? undefined
      : resolveChangeLayout(schema, Array.isArray(channels.changed) ? channels.changed : undefined);

  return Object.freeze({
    ...(changed === undefined ? {} : { changed }),
    ...(channels.patch === true ? { patch: true as const } : {}),
    ...(channels.inverse === true ? { inverse: true as const } : {}),
  });
}

function compileMutation<T>(
  schema: AnyTypeSchema,
  plan: MutationPlan,
  explanation: MutationExplanation,
  outputs: MutationOutputs
): ((value: T, params: Readonly<Record<string, unknown>>) => unknown) & { layout(): ChangeLayout | undefined } {
  const source = emitMutationSource(plan, outputs);
  const names = plan.bindings.map((_, index) => `__q${index}`);
  const mutate = globalThis.Function(...names, source)(...plan.bindings) as ((
    value: T,
    params: Readonly<Record<string, unknown>>
  ) => unknown) & { layout(): ChangeLayout | undefined };

  Object.defineProperty(mutate, "layout", { enumerable: false, value: () => outputs.changed });
  registerArtifact(mutate as object, {
    kind: "mutation-plan",
    schema,
    source,
    bindingNames: names,
    bindingValues: plan.bindings,
    reads: explanation.reads,
    writes: explanation.writes,
    params: explanation.params,
    ...(outputs.changed === undefined ? {} : { layout: outputs.changed }),
  });
  return mutate;
}

/** Function-body source for one plan; shared by the runtime and AOT hosts. */
export function emitMutationSource(plan: MutationPlan, outputs: MutationOutputs = {}): string {
  return `return function mutate(value, params) {\n${emitMutationBody(plan, outputs)}};`;
}

/**
 * Flattens a declared template into normalized writes.
 *
 * A nested plain object descends only when the schema says that level is an
 * object; anywhere else it is the value being written, which is what keeps the
 * declaration and the deep-partial patch it replaces in agreement.
 */
export function collectPatchWrites(
  schema: AnyTypeSchema,
  template: unknown,
  path: readonly string[],
  bindings: unknown[]
): MutationWriteInput[] | undefined {
  if (template === null || typeof template !== "object" || Array.isArray(template) || isParamRef(template)) {
    if (path.length === 0) return undefined;
    if (isParamRef(template)) return [{ path, value: { kind: "param", name: template.name } }];
    bindings.push(template);
    return [{ path, value: { kind: "binding", index: bindings.length - 1 } }];
  }

  const base = resolveWrappers(schema).base;
  if (base.type !== TypeName.object) {
    if (path.length === 0) return undefined;
    bindings.push(template);
    return [{ path, value: { kind: "binding", index: bindings.length - 1 } }];
  }

  const props = (base.def as ObjectDef).props;
  const out: MutationWriteInput[] = [];
  for (const key of Object.keys(template)) {
    const child = props[key];
    if (child === undefined) return undefined;
    const nested = collectPatchWrites(
      child,
      (template as Readonly<Record<string, unknown>>)[key],
      [...path, key],
      bindings
    );
    if (nested === undefined) return undefined;
    out.push(...nested);
  }
  return out;
}

function materializeParamPatch(template: unknown, params: Readonly<Record<string, unknown>>): unknown {
  if (isParamRef(template)) return params[template.name];
  if (Array.isArray(template)) return template.map((value) => materializeParamPatch(value, params));

  if (template !== null && typeof template === "object") {
    const out: Record<string, unknown> = {};

    for (const key of Object.keys(template)) {
      out[key] = materializeParamPatch((template as Readonly<Record<string, unknown>>)[key], params);
    }
    return out;
  }

  return template;
}

function isParamRef(value: unknown): value is QueryParamRef {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { readonly __jitQueryValue?: unknown }).__jitQueryValue === "param"
  );
}

function captureDraftPatch<T>(recipe: UpdateRecipe<T>): UpdatePatch<T> {
  const writes: Array<{
    readonly path: readonly PropertyKey[];
    readonly value: unknown;
  }> = [];
  const proxies = new Map<string, unknown>();

  const createDraft = (path: readonly PropertyKey[]): unknown => {
    const cacheKey = path.map(String).join("\u0000");
    const cached = proxies.get(cacheKey);

    if (cached) return cached;

    const draft = new Proxy(
      {},
      {
        get(_target, key) {
          if (typeof key === "symbol") return undefined;
          return createDraft([...path, key]);
        },
        set(_target, key, value) {
          if (typeof key === "symbol") {
            throw new JITError("INVALID_UPDATE", "Draft updates do not support symbol keys");
          }

          writes[writes.length] = { path: [...path, key], value };
          return true;
        },
      }
    );

    proxies.set(cacheKey, draft);
    return draft;
  };

  recipe(createDraft([]) as Draft<T>);

  return materializePatch(writes) as UpdatePatch<T>;
}

function materializePatch(
  writes: Array<{
    readonly path: readonly PropertyKey[];
    readonly value: unknown;
  }>
): unknown {
  const root: Record<string, unknown> = {};

  for (const write of writes) {
    let current: Record<string, unknown> | unknown[] = root;

    for (let index = 0; index < write.path.length; index++) {
      const segment = write.path[index];
      const key = normalizeKey(segment);
      const isLast = index === write.path.length - 1;

      if (isLast) {
        current[key as never] = write.value as never;
        continue;
      }

      const nextSegment = write.path[index + 1];
      const existing = current[key as never] as Record<string, unknown> | unknown[] | undefined;

      if (existing === undefined) {
        const next = isArrayKey(nextSegment) ? [] : {};
        current[key as never] = next as never;
        current = next;
      } else {
        current = existing;
      }
    }
  }

  return root;
}

function normalizeKey(key: PropertyKey): string | number {
  if (typeof key === "number") return key;
  if (typeof key === "string" && key !== "" && String(Number(key)) === key) return Number(key);
  return String(key);
}

function isArrayKey(key: PropertyKey | undefined): boolean {
  return typeof key === "number" || (typeof key === "string" && key !== "" && String(Number(key)) === key);
}

function assertUpdateable(schema: AnyTypeSchema): void {
  if (schema.type === TypeName.readonly) {
    throw new JITError("READONLY_FIELD", "Cannot compile updates for readonly schemas");
  }

  if (schema.type === TypeName.lazy) {
    assertUpdateable((schema.def as LazyDef<AnyTypeSchema>).getter());
    return;
  }

  if (hasInnerType(schema)) {
    assertUpdateable((schema.def as InnerTypeDef<AnyTypeSchema>).innerType);
    return;
  }

  if (schema.type === TypeName.object) {
    const objectSchema = schema as import("../core/ats/index.js").ObjectSchema<
      import("../core/ats/index.js").SchemaShape
    >;

    for (const child of Object.values(objectSchema.def.props)) {
      assertUpdateable(child);
    }
  }
}

function hasInnerType(schema: AnyTypeSchema): boolean {
  return (
    schema.type === TypeName.optional ||
    schema.type === TypeName.nullable ||
    schema.type === TypeName.nullish ||
    schema.type === TypeName.default ||
    schema.type === TypeName.brand ||
    schema.type === TypeName.transform ||
    schema.type === TypeName.pipe ||
    schema.type === TypeName.refine ||
    schema.type === TypeName.coerce ||
    schema.type === TypeName.promise
  );
}
