import type { DiffChange } from "../../compiler/diff.js";

type PathKey = string | number;
type NextDepth<TDepth extends readonly unknown[]> = readonly [...TDepth, unknown];
type ReactiveAtomic =
  | Date
  | RegExp
  | Map<unknown, unknown>
  | Set<unknown>
  | WeakMap<object, unknown>
  | WeakSet<object>
  | Promise<unknown>
  | ((...args: never[]) => unknown);
type MissingPathValue<TValue> = undefined extends TValue ? undefined : null extends TValue ? undefined : never;

/** Type-safe tuple paths accepted by reactive property watchers. */
export type ReactivePath<TValue, TDepth extends readonly unknown[] = []> = TDepth["length"] extends 6
  ? readonly PathKey[]
  : TValue extends readonly (infer TItem)[]
    ? readonly [number] | readonly [number, ...ReactivePath<TItem, NextDepth<TDepth>>]
    : TValue extends object
      ? {
          [TKey in Extract<keyof TValue, PathKey>]-?:
            | readonly [TKey]
            | (NonNullable<TValue[TKey]> extends object
                ? NonNullable<TValue[TKey]> extends ReactiveAtomic
                  ? never
                  : readonly [TKey, ...ReactivePath<NonNullable<TValue[TKey]>, NextDepth<TDepth>>]
                : never);
        }[Extract<keyof TValue, PathKey>]
      : never;

/** Resolves the value stored at a type-safe tuple path. */
export type ReactivePathValue<TValue, TPath extends readonly PathKey[]> = TPath extends readonly [
  infer THead,
  ...infer TTail,
]
  ? THead extends keyof TValue
    ? TTail extends readonly PathKey[]
      ? TTail extends readonly []
        ? TValue[THead]
        : ReactivePathValue<NonNullable<TValue[THead]>, TTail> | MissingPathValue<TValue[THead]>
      : never
    : TValue extends readonly (infer TItem)[]
      ? THead extends number
        ? TTail extends readonly PathKey[]
          ? ReactivePathValue<TItem, TTail>
          : never
        : never
      : never
  : TValue;

export interface ReactiveChange {
  readonly type: "add" | "remove" | "update";
  readonly path: readonly PropertyKey[];
  readonly previous: unknown;
  readonly value: unknown;
}

export interface ReactiveUpdateEvent<TValue> {
  readonly previous: TValue;
  readonly value: TValue;
  readonly version: number;
  /** Lazily computed; no diff array is allocated unless a listener reads it. */
  readonly changes: readonly ReactiveChange[];
}

export interface ReactivePathEvent<TValue, TSelected = unknown> {
  readonly path: readonly PathKey[];
  readonly previous: TSelected;
  readonly value: TSelected;
  readonly rootPrevious: TValue;
  readonly root: TValue;
  readonly version: number;
}

export interface ReactiveSelectionEvent<TValue, TSelected> {
  readonly previous: TSelected;
  readonly value: TSelected;
  readonly rootPrevious: TValue;
  readonly root: TValue;
  readonly version: number;
}

export interface ReactiveSubscribeOptions {
  readonly immediate?: boolean;
}

export interface ReactiveWatchOptions<TValue> extends ReactiveSubscribeOptions {
  readonly equals?: (previous: TValue, value: TValue) => boolean;
}

export type ReactiveScheduler = "sync" | "microtask" | ((flush: () => void) => void);

export interface ReactiveUpdateOptions {
  /** `sync` by default; `microtask` coalesces all writes in the current turn. */
  readonly schedule?: ReactiveScheduler;
  /** Handles subscriber exceptions without interrupting the remaining listeners. */
  readonly onError?: (error: unknown) => void;
}

export interface ReactiveUpdateController<TValue, TInput> {
  readonly value: TValue;
  readonly version: number;
  update(input: TInput): TValue;
  set(value: TValue): TValue;
  subscribe(listener: (event: ReactiveUpdateEvent<TValue>) => void, options?: ReactiveSubscribeOptions): () => void;
  watch<const TPath extends ReactivePath<TValue> | string>(
    path: TPath,
    listener: (
      event: ReactivePathEvent<TValue, TPath extends readonly PathKey[] ? ReactivePathValue<TValue, TPath> : unknown>
    ) => void,
    options?: ReactiveWatchOptions<TPath extends readonly PathKey[] ? ReactivePathValue<TValue, TPath> : unknown>
  ): () => void;
  select<TSelected>(
    selector: (value: TValue) => TSelected,
    listener: (event: ReactiveSelectionEvent<TValue, TSelected>) => void,
    options?: ReactiveWatchOptions<TSelected>
  ): () => void;
  batch(run: (store: ReactiveUpdateController<TValue, TInput>) => void): TValue;
  flush(): void;
  dispose(): void;
}

interface PathListener<TValue> {
  readonly listener: (event: ReactivePathEvent<TValue>) => void;
  readonly equals: (previous: unknown, value: unknown) => boolean;
}

interface PathBucket<TValue> {
  readonly path: readonly PathKey[];
  readonly listeners: Set<PathListener<TValue>>;
}

interface SelectionListener<TValue> {
  readonly selector: (value: TValue) => unknown;
  readonly listener: (event: ReactiveSelectionEvent<TValue, unknown>) => void;
  readonly equals: (previous: unknown, value: unknown) => boolean;
}

/** Internal generic constructor used by the public `JIT.update` facade. */
export function createReactiveUpdate<TValue, TInput>(
  initial: TValue,
  updater: (value: TValue, input: TInput) => TValue,
  createDiff: () => (previous: TValue, value: TValue) => DiffChange[],
  options: ReactiveUpdateOptions = {}
): ReactiveUpdateController<TValue, TInput> {
  let value = initial;
  let version = 0;
  let batchDepth = 0;
  let batchPrevious: TValue | undefined;
  let hasBatchPrevious = false;
  let pendingPrevious: TValue | undefined;
  let hasPendingPrevious = false;
  let scheduled = false;
  let disposed = false;
  let diff: ((previous: TValue, value: TValue) => DiffChange[]) | undefined;
  const listeners = new Set<(event: ReactiveUpdateEvent<TValue>) => void>();
  const pathBuckets = new Map<string, PathBucket<TValue>>();
  const selections = new Set<SelectionListener<TValue>>();
  const scheduler = options.schedule ?? "sync";

  const report = (error: unknown): void => {
    if (options.onError) {
      options.onError(error);
      return;
    }
    throw error;
  };

  const invoke = (listener: () => void): void => {
    if (!options.onError) {
      listener();
      return;
    }
    try {
      listener();
    } catch (error) {
      report(error);
    }
  };

  const notify = (previous: TValue, current: TValue): void => {
    if (disposed || Object.is(previous, current)) return;

    const eventVersion = version;
    let cachedChanges: readonly ReactiveChange[] | undefined;
    const event: ReactiveUpdateEvent<TValue> = {
      previous,
      value: current,
      version: eventVersion,
      get changes() {
        if (cachedChanges) return cachedChanges;
        diff ??= createDiff();
        cachedChanges = diff(previous, current).map((change) => ({
          type: change.type,
          path: change.path,
          previous: readPath(previous, change.path),
          value: readPath(current, change.path),
        }));
        return cachedChanges;
      },
    };

    for (const listener of listeners) invoke(() => listener(event));

    for (const bucket of pathBuckets.values()) {
      const before = readPath(previous, bucket.path);
      const after = readPath(current, bucket.path);

      for (const entry of bucket.listeners) {
        if (entry.equals(before, after)) continue;
        const pathEvent: ReactivePathEvent<TValue> = {
          path: bucket.path,
          previous: before,
          value: after,
          rootPrevious: previous,
          root: current,
          version: eventVersion,
        };

        invoke(() => entry.listener(pathEvent));
      }
    }

    for (const entry of selections) {
      const before = entry.selector(previous);
      const after = entry.selector(current);

      if (entry.equals(before, after)) continue;
      const selectionEvent: ReactiveSelectionEvent<TValue, unknown> = {
        previous: before,
        value: after,
        rootPrevious: previous,
        root: current,
        version: eventVersion,
      };

      invoke(() => entry.listener(selectionEvent));
    }
  };

  const flush = (): void => {
    if (!scheduled || !hasPendingPrevious) return;
    const previous = pendingPrevious as TValue;

    scheduled = false;
    pendingPrevious = undefined;
    hasPendingPrevious = false;
    notify(previous, value);
  };

  const enqueue = (previous: TValue): void => {
    if (batchDepth > 0) {
      if (!hasBatchPrevious) {
        batchPrevious = previous;
        hasBatchPrevious = true;
      }
      return;
    }
    if (scheduler === "sync") {
      notify(previous, value);
      return;
    }

    if (!hasPendingPrevious) {
      pendingPrevious = previous;
      hasPendingPrevious = true;
    }
    if (scheduled) return;
    scheduled = true;

    if (scheduler === "microtask") queueMicrotask(flush);
    else scheduler(flush);
  };

  const set = (next: TValue): TValue => {
    if (disposed || Object.is(value, next)) return value;
    const previous = value;

    value = next;
    version++;
    enqueue(previous);
    return value;
  };

  const controller: ReactiveUpdateController<TValue, TInput> = {
    get value() {
      return value;
    },
    get version() {
      return version;
    },
    update(input) {
      return set(updater(value, input));
    },
    set,
    subscribe(listener, subscribeOptions = {}) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      if (subscribeOptions.immediate) {
        const immediate: ReactiveUpdateEvent<TValue> = {
          previous: value,
          value,
          version,
          changes: [],
        };
        invoke(() => listener(immediate));
      }
      return () => listeners.delete(listener);
    },
    watch<TPath extends ReactivePath<TValue> | string>(
      path: TPath,
      listener: (
        event: ReactivePathEvent<TValue, TPath extends readonly PathKey[] ? ReactivePathValue<TValue, TPath> : unknown>
      ) => void,
      watchOptions: ReactiveWatchOptions<
        TPath extends readonly PathKey[] ? ReactivePathValue<TValue, TPath> : unknown
      > = {}
    ) {
      if (disposed) return () => undefined;
      const normalized = normalizePath(path);
      const key = JSON.stringify(normalized);
      let bucket = pathBuckets.get(key);

      if (!bucket) {
        bucket = { path: normalized, listeners: new Set() };
        pathBuckets.set(key, bucket);
      }

      const entry: PathListener<TValue> = {
        listener: (event) =>
          listener(
            event as ReactivePathEvent<
              TValue,
              TPath extends readonly PathKey[] ? ReactivePathValue<TValue, TPath> : unknown
            >
          ),
        equals: watchOptions.equals ?? Object.is,
      };

      bucket.listeners.add(entry);
      if (watchOptions.immediate) {
        const selected = readPath(value, normalized);
        invoke(() =>
          listener({
            path: normalized,
            previous: selected,
            value: selected,
            rootPrevious: value,
            root: value,
            version,
          } as ReactivePathEvent<TValue, TPath extends readonly PathKey[] ? ReactivePathValue<TValue, TPath> : unknown>)
        );
      }

      return () => {
        bucket?.listeners.delete(entry);
        if (bucket?.listeners.size === 0) pathBuckets.delete(key);
      };
    },
    select<TSelected>(
      selector: (value: TValue) => TSelected,
      listener: (event: ReactiveSelectionEvent<TValue, TSelected>) => void,
      selectOptions: ReactiveWatchOptions<TSelected> = {}
    ) {
      if (disposed) return () => undefined;
      const entry: SelectionListener<TValue> = {
        selector,
        listener: (event) => listener(event as ReactiveSelectionEvent<TValue, TSelected>),
        equals: selectOptions.equals ?? Object.is,
      };

      selections.add(entry);
      if (selectOptions.immediate) {
        const selected = selector(value);
        invoke(() =>
          listener({
            previous: selected,
            value: selected,
            rootPrevious: value,
            root: value,
            version,
          })
        );
      }
      return () => selections.delete(entry);
    },
    batch(run) {
      batchDepth++;
      try {
        run(controller);
      } finally {
        batchDepth--;
        if (batchDepth === 0 && hasBatchPrevious) {
          const previous = batchPrevious as TValue;

          batchPrevious = undefined;
          hasBatchPrevious = false;
          enqueue(previous);
        }
      }
      return value;
    },
    flush,
    dispose() {
      disposed = true;
      listeners.clear();
      pathBuckets.clear();
      selections.clear();
      pendingPrevious = undefined;
      hasPendingPrevious = false;
      batchPrevious = undefined;
      hasBatchPrevious = false;
      scheduled = false;
    },
  };

  return controller;
}

function normalizePath(path: readonly PathKey[] | string): readonly PathKey[] {
  if (typeof path !== "string") return Object.freeze([...path]);
  if (path === "") return Object.freeze([]);

  return Object.freeze(
    path.split(".").map((part) => (part !== "" && String(Number(part)) === part ? Number(part) : part))
  );
}

function readPath(value: unknown, path: readonly PropertyKey[]): unknown {
  let current = value;

  for (let index = 0; index < path.length; index++) {
    if (current === null || current === undefined) return undefined;
    current = (current as Readonly<Record<PropertyKey, unknown>>)[path[index]];
  }
  return current;
}
