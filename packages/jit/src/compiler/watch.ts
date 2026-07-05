import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { resolveWrappers } from "./resolvers/resolve-wrappers.js";
import { emitPropertyAccess } from "./source/access.js";

type ArraySchema = ATS.AnyTypeSchema & { readonly def: ATS.ElementDef };
type SetSchema = ATS.AnyTypeSchema & { readonly def: ATS.ElementDef };
type MapSchema = ATS.AnyTypeSchema & { readonly def: ATS.KeyValueDef };
type ObjectSchema = ATS.AnyTypeSchema & { readonly def: ATS.ObjectDef };
type WatchCollectionKind = "array" | "set" | "map";

type CollectionElement<TValue> = TValue extends readonly (infer TElement)[]
  ? TElement
  : TValue extends Set<infer TElement>
    ? TElement
    : TValue extends Map<unknown, infer TElement>
      ? TElement
      : never;

/**
 * The outcome of one keyed collection comparison.
 *
 * @template TItem - The element type of the watched collection.
 */
export interface WatchResult<TItem> {
  readonly currentItems: TItem[];
  readonly initialItems: TItem[];
  readonly newItems: TItem[];
  readonly removedItems: TItem[];
  readonly updatedItems: Array<{ readonly previous: TItem; readonly current: TItem }>;
  readonly isChanged: boolean;
}

/**
 * Options for a compiled watch function. `key` identifies items across the two
 * snapshots; the optional callbacks fire per detected change.
 *
 * @template TItem - The element type of the watched collection.
 */
export interface WatchOptions<TItem> {
  readonly key: Extract<keyof TItem, string>;
  readonly onAdd?: (item: TItem) => void;
  readonly onRemove?: (item: TItem) => void;
  readonly onUpdate?: (previous: TItem, current: TItem) => void;
}

/**
 * A compiled keyed diff over two snapshots of a collection.
 *
 * @template TValue - The collection type (array, Set, or Map of objects).
 * @param previous - The previous collection snapshot.
 * @param current - The current collection snapshot.
 * @returns Added, removed, updated, and change-summary information.
 */
export type Watch<TValue> = (previous: TValue, current: TValue) => WatchResult<CollectionElement<TValue>>;

interface WatchTarget {
  readonly kind: WatchCollectionKind;
  readonly objectSchema: ObjectSchema;
}

interface WatchProgram {
  readonly source: string;
  readonly bindings: readonly unknown[];
}

/**
 * Emits the JavaScript source of a compiled watch function.
 *
 * @template TSchema - The collection schema used to type the watch options.
 * @param schema - The collection schema the watcher runs against.
 * @param options - The key and optional change callbacks.
 * @returns The generated watch source.
 */
export function emitWatchSource<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  options: WatchOptions<CollectionElement<ATS.InferSchema<TSchema>>>
): string {
  return emitWatchProgram(schema, options).source;
}

/**
 * Compiles a keyed collection watcher: given a previous and a current
 * snapshot, it reports added, removed, and updated items in O(n) using a
 * key-indexed map, and invokes the `onAdd`/`onRemove`/`onUpdate` callbacks.
 *
 * @template TSchema - The collection schema (array/Set/Map of objects).
 * @param schema - The collection schema the watcher runs against.
 * @param options - The key and optional change callbacks.
 * @returns A compiled keyed collection watcher.
 *
 * @example
 * ```ts
 * const watch = compileWatch(Users.schema, { key: "id" });
 * const result = watch(previousUsers, currentUsers);
 * result.newItems; result.removedItems; result.updatedItems;
 * ```
 */
export function compileWatch<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  options: WatchOptions<CollectionElement<ATS.InferSchema<TSchema>>>
): Watch<ATS.InferSchema<TSchema>> {
  const program = emitWatchProgram(schema, options);
  const bindingNames = program.bindings.map((_, index) => `__w${index}`);

  return globalThis.Function(...bindingNames, `return ${program.source};`)(...program.bindings) as Watch<
    ATS.InferSchema<TSchema>
  >;
}

function emitWatchProgram<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  options: WatchOptions<CollectionElement<ATS.InferSchema<TSchema>>>
): WatchProgram {
  const target = expectWatchTarget(schema, "emitWatchSource");
  const key = options.key;

  validateObjectKeys(target.objectSchema, [key], "watch");

  const bindings: unknown[] = [];
  const onAdd = addOptionalBinding(bindings, options.onAdd);
  const onRemove = addOptionalBinding(bindings, options.onRemove);
  const onUpdate = addOptionalBinding(bindings, options.onUpdate);
  const keyAccess = emitPropertyAccess("item", key);
  const previousKeyAccess = emitPropertyAccess("previousItem", key);
  const writer = new CodeWriter();

  writer.line("function watch(previous, current) {");
  writer.indent(() => {
    writer.line("const previousIndex = new Map();");
    writer.line("const currentIndex = new Map();");
    writer.line("const initialItems = [];");
    emitCollectionLoop(writer, target, "previous", "previousItem", () => {
      writer.line(`const id = ${previousKeyAccess};`);
      writer.line("previousIndex.set(id, previousItem);");
      writer.line("initialItems[initialItems.length] = previousItem;");
    });
    writer.line("const currentItems = [];");
    writer.line("const newItems = [];");
    writer.line("const removedItems = [];");
    writer.line("const updatedItems = [];");
    emitCollectionLoop(writer, target, "current", "item", () => {
      writer.line(`const id = ${keyAccess};`);
      writer.line("currentIndex.set(id, item);");
      writer.line("currentItems[currentItems.length] = item;");
      writer.line("const previousItem = previousIndex.get(id);");
      writer.line("if (previousItem === undefined) {");
      writer.indent(() => {
        writer.line("newItems[newItems.length] = item;");
        if (onAdd) writer.line(`${onAdd}(item);`);
      });
      writer.line("} else if (previousItem !== item) {");
      writer.indent(() => {
        writer.line("updatedItems[updatedItems.length] = { previous: previousItem, current: item };");
        if (onUpdate) writer.line(`${onUpdate}(previousItem, item);`);
      });
      writer.line("}");
    });
    emitCollectionLoop(writer, target, "previous", "previousItem", () => {
      writer.line(`const id = ${previousKeyAccess};`);
      writer.line("if (!currentIndex.has(id)) {");
      writer.indent(() => {
        writer.line("removedItems[removedItems.length] = previousItem;");
        if (onRemove) writer.line(`${onRemove}(previousItem);`);
      });
      writer.line("}");
    });
    writer.line("const isChanged = newItems.length !== 0 || removedItems.length !== 0 || updatedItems.length !== 0;");
    writer.line("return { currentItems, initialItems, newItems, removedItems, updatedItems, isChanged };");
  });
  writer.line("}");

  return { source: writer.toString(), bindings };
}

function emitCollectionLoop(
  writer: CodeWriter,
  target: WatchTarget,
  collection: "previous" | "current",
  itemName: "previousItem" | "item",
  body: () => void
): void {
  switch (target.kind) {
    case "array":
      writer.line(`for (let i = 0, len = ${collection}.length; i < len; i++) {`);
      writer.indent(() => {
        writer.line(`const ${itemName} = ${collection}[i];`);
        body();
      });
      writer.line("}");
      return;
    case "set":
      writer.line(`for (const ${itemName} of ${collection}) {`);
      writer.indent(body);
      writer.line("}");
      return;
    case "map":
      writer.line(`for (const entry of ${collection}) {`);
      writer.indent(() => {
        writer.line(`const ${itemName} = entry[1];`);
        body();
      });
      writer.line("}");
      return;
  }
}

function addOptionalBinding(bindings: unknown[], value: unknown): string | undefined {
  if (value === undefined) return undefined;

  const name = `__w${bindings.length}`;

  bindings[bindings.length] = value;
  return name;
}

function expectWatchTarget(schema: ATS.AnyTypeSchema, compilerName: string): WatchTarget {
  const resolved = resolveWrappers(schema).base;

  if (resolved.type !== TypeName.array && resolved.type !== TypeName.set && resolved.type !== TypeName.map) {
    throw new JITError("INVALID_OPERATION", `${compilerName} expects an array, set, or map schema`);
  }

  const element =
    resolved.type === TypeName.map
      ? resolveWrappers((resolved as MapSchema).def.value).base
      : resolveWrappers((resolved as ArraySchema | SetSchema).def.element).base;

  if (element.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", `${compilerName} expects a collection of object schema`);
  }

  return { kind: resolved.type as WatchCollectionKind, objectSchema: element as ObjectSchema };
}

function validateObjectKeys(schema: ObjectSchema, keys: readonly string[], compilerName: string): void {
  const props = schema.def.props;

  for (const key of keys) {
    if (!(key in props)) {
      throw new JITError("INVALID_OPERATION", `${compilerName} received unknown key ${JSON.stringify(key)}`, {
        path: [key],
      });
    }
  }
}
