import type * as ATS from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { compileDiff } from "./diff.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { compileEqual } from "./equal.js";
import { resolveIndexKeysFromFacts } from "./indexing.js";
import { resolveRowField, resolveRowObjectSchema, resolveScalarKeyKind } from "./row-keys.js";
import { emitPropertyAccess } from "./source/access.js";

/** Which result channels a caller actually asked for. An unrequested one is never built. */
export interface ReconcileChannels {
  readonly added: boolean;
  readonly removed: boolean;
  readonly changed: boolean;
  readonly unchanged: boolean;
}

export type ReconcileChanges = "value" | "diff";
export type ReconcileSink = "result" | "iterator" | "visitor";

export interface ReconcileDescriptor {
  readonly key: string;
  /** A Date key is matched by timestamp, the way an index stores it. */
  readonly date: boolean;
  readonly channels: ReconcileChannels;
  /** `diff` attaches a compiled diff to each changed pair; it runs only when equality failed. */
  readonly changes: ReconcileChanges;
  readonly sink: ReconcileSink;
}

export const ALL_CHANNELS: ReconcileChannels = Object.freeze({
  added: true,
  removed: true,
  changed: true,
  unchanged: true,
});

export function resolveReconcileDescriptor(
  schema: ATS.AnyTypeSchema,
  key: string | undefined,
  channels: ReconcileChannels,
  changes: ReconcileChanges,
  sink: ReconcileSink
): ReconcileDescriptor {
  const object = resolveRowObjectSchema(schema, "reconcile");
  const resolved = key ?? resolveIndexKeysFromFacts(schema)?.[0];

  if (!resolved) {
    throw new JITError(
      "UNSUPPORTED_SCHEMA",
      "JIT.reconcile() needs an identity: declare one with .keyed()/.indexBy()/.uniqueBy()/.entity(), or name it with .by()"
    );
  }

  const field = resolveRowField(object, resolved, "reconcile");

  return Object.freeze({
    key: resolved,
    date: resolveScalarKeyKind(field, resolved, "reconcile") === "date",
    channels: Object.freeze({ ...channels }),
    changes,
    sink,
  });
}

/**
 * One pass over each side.
 *
 * Identity is indexed from the previous snapshot, the current snapshot is read
 * once against it, and whatever the index still holds afterwards is what was
 * removed. Nothing is searched twice, and a channel the caller turned off is
 * never allocated, never appended to and — for `removed` — never even walked.
 */
export function emitReconcileSource(descriptor: ReconcileDescriptor): string {
  const writer = new CodeWriter();
  const { channels, sink } = descriptor;
  const previousKey = readKey(descriptor, "previousItem");
  const currentKey = readKey(descriptor, "item");
  // `removed` is the only channel that needs the index to shrink as it matches.
  const consumes = channels.removed;
  const emit = emitter(sink);

  writer.line(`${sink === "iterator" ? "function*" : "function"} reconcile(previous, current${sinkParam(sink)}) {`);
  writer.indent(() => {
    writer.line("const index = new Map();");
    writer.line("for (let i = 0, len = previous.length; i < len; i++) {");
    writer.indent(() => {
      writer.line("const previousItem = previous[i];");
      writer.line(`index.set(${previousKey}, previousItem);`);
    });
    writer.line("}");

    if (sink === "result") {
      if (channels.added) writer.line("const added = [];");
      if (channels.removed) writer.line("const removed = [];");
      if (channels.changed) writer.line("const changed = [];");
      if (channels.unchanged) writer.line("const unchanged = [];");
    }

    writer.line("for (let i = 0, len = current.length; i < len; i++) {");
    writer.indent(() => {
      writer.line("const item = current[i];");

      // Only the branches that can record something are emitted at all, so a
      // narrowed reconciliation is a smaller loop rather than a guarded one.
      const comparesRows = channels.changed || channels.unchanged;
      const needsPrevious = channels.added || comparesRows;

      // With nothing to compare and nothing to report as added, matching is
      // only about shrinking the index — and `delete` answers that in one
      // lookup where `get` then `delete` would take two.
      if (!needsPrevious) {
        if (consumes) writer.line(`index.delete(${currentKey});`);
        return;
      }

      writer.line(`const id = ${currentKey};`);
      writer.line("const previousItem = index.get(id);");

      const writeMatched = () => {
        if (consumes) writer.line("index.delete(id);");
        emitMatched(writer, descriptor, emit);
      };

      if (channels.added) {
        writer.line("if (previousItem === undefined) {");
        writer.indent(() => emit(writer, "added", "item"));
        if (consumes || comparesRows) {
          writer.line("} else {");
          writer.indent(writeMatched);
        }
        writer.line("}");
      } else {
        writer.line("if (previousItem !== undefined) {");
        writer.indent(writeMatched);
        writer.line("}");
      }
    });
    writer.line("}");

    // Whatever the index still holds was never matched, so it is what was removed.
    if (channels.removed) {
      writer.line("for (const previousItem of index.values()) {");
      writer.indent(() => emit(writer, "removed", "previousItem"));
      writer.line("}");
    }

    if (sink === "result") writer.line(`return ${resultLiteral(channels)};`);
    if (sink === "visitor") writer.line("return undefined;");
  });
  writer.line("}");
  return writer.toString();
}

/**
 * What happens to a row that exists on both sides.
 *
 * Equality is only asked when an answer depends on it: if neither `changed`
 * nor `unchanged` was requested, the rows are never compared at all. A
 * reference check settles the common case before any field is read.
 */
function emitMatched(writer: CodeWriter, descriptor: ReconcileDescriptor, emit: ReturnType<typeof emitter>): void {
  const { changed, unchanged } = descriptor.channels;

  if (!changed && !unchanged) return;

  if (changed && !unchanged) {
    writer.line("if (previousItem !== item && !__reconcileEqual(previousItem, item)) {");
    writer.indent(() => emitChanged(writer, descriptor, emit));
    writer.line("}");
    return;
  }

  if (unchanged && !changed) {
    writer.line("if (previousItem === item || __reconcileEqual(previousItem, item)) {");
    writer.indent(() => emit(writer, "unchanged", "item"));
    writer.line("}");
    return;
  }

  writer.line("if (previousItem === item || __reconcileEqual(previousItem, item)) {");
  writer.indent(() => emit(writer, "unchanged", "item"));
  writer.line("} else {");
  writer.indent(() => emitChanged(writer, descriptor, emit));
  writer.line("}");
}

function emitChanged(writer: CodeWriter, descriptor: ReconcileDescriptor, emit: ReturnType<typeof emitter>): void {
  // The diff runs only here: equality already failed, so it is never wasted.
  if (descriptor.changes === "diff") {
    writer.line("const delta = __reconcileDiff(previousItem, item);");
    emit(writer, "changed", "{ before: previousItem, after: item, diff: delta }", "previousItem, item, delta");
    return;
  }
  emit(writer, "changed", "{ before: previousItem, after: item }", "previousItem, item");
}

/**
 * How one result reaches the caller. The array sink appends, the visitor calls
 * straight through and the iterator yields — so the visitor and iterator never
 * build a result at all.
 */
function emitter(sink: ReconcileSink) {
  return (writer: CodeWriter, channel: string, value: string, visitorArgs = value): void => {
    if (sink === "visitor") {
      writer.line(`if (visitor.${channel} !== undefined) visitor.${channel}(${visitorArgs});`);
      return;
    }
    if (sink === "iterator") {
      writer.line(`yield { type: ${JSON.stringify(channel)}, value: ${value} };`);
      return;
    }
    writer.line(`${channel}[${channel}.length] = ${value};`);
  };
}

function sinkParam(sink: ReconcileSink): string {
  return sink === "visitor" ? ", visitor" : "";
}

function resultLiteral(channels: ReconcileChannels): string {
  const parts: string[] = [];

  if (channels.added) parts.push("added");
  if (channels.removed) parts.push("removed");
  if (channels.changed) parts.push("changed");
  if (channels.unchanged) parts.push("unchanged");
  return `{ ${parts.join(", ")} }`;
}

function readKey(descriptor: ReconcileDescriptor, row: string): string {
  const access = emitPropertyAccess(row, descriptor.key);
  return descriptor.date ? `${access}.getTime()` : access;
}

export function reconcileCacheKey(descriptor: ReconcileDescriptor): string {
  const { channels } = descriptor;
  const on = [channels.added && "a", channels.removed && "r", channels.changed && "c", channels.unchanged && "u"]
    .filter(Boolean)
    .join("");

  return `reconcile:${descriptor.sink}:${descriptor.key}:${descriptor.date}:${descriptor.changes}:${on}`;
}

export function compileReconcile<TResult>(
  schema: ATS.AnyTypeSchema,
  descriptor: ReconcileDescriptor,
  options?: CompileCacheOptions
): TResult {
  const object = resolveRowObjectSchema(schema, "reconcile");
  const template = getCompileCached(
    schema,
    reconcileCacheKey(descriptor),
    () => {
      const source = emitReconcileSource(descriptor);
      return {
        source,
        create: globalThis.Function("__reconcileEqual", "__reconcileDiff", `return ${source};`),
      };
    },
    options
  );
  const compiled = template.create(
    compileEqual(object),
    descriptor.changes === "diff" ? compileDiff(object) : undefined
  ) as TResult;

  registerArtifact(compiled as object, { kind: "reconcile-plan", schema, descriptor });
  return compiled;
}
