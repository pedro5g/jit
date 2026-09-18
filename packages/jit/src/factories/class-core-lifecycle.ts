import type { LifecycleDefinition } from "../classes/effective-schema.js";
import { lifecycleArtifact } from "../classes/lifecycle-artifact.js";
import { JITError } from "../errors/index.js";
import type { ClassDefinitionState } from "./class-core-state.js";
import { definePrototype } from "./class-core-support.js";
import type { ManagedStorageBinding } from "./class-layout.js";
import { EVENT_BUFFER } from "./class-layout.js";
import type { AnyDomainEvent, EventPublisher } from "./class-types.js";

export { lifecycleArtifact };

export function installLifecycleMethods(
  classTarget: Function,
  state: ClassDefinitionState,
  managedStorage: ReadonlyMap<string, ManagedStorageBinding>,
  domainState: ManagedStorageBinding | undefined
): void {
  const context: LifecycleEmitterContext = { classTarget, managedStorage, domainState };
  const lifecycle = state.lifecycle;
  if (lifecycle.timestamps !== undefined || lifecycle.versioned !== undefined)
    installTimestampLifecycle(context, lifecycle);
  if (lifecycle.softDelete !== undefined) installDeletionLifecycle(context, lifecycle);
  if (state.aggregate) installAggregateLifecycle(classTarget);
}

interface LifecycleEmitterContext {
  readonly classTarget: Function;
  readonly managedStorage: ReadonlyMap<string, ManagedStorageBinding>;
  readonly domainState: ManagedStorageBinding | undefined;
}

function managedAccess(context: LifecycleEmitterContext, field: string): string {
  if (context.domainState !== undefined) return `this[__state][${JSON.stringify(field)}]`;
  const storage = context.managedStorage.get(field);
  return storage === undefined ? `this[${JSON.stringify(field)}]` : `this[${storage.name}]`;
}

function managedWrite(context: LifecycleEmitterContext, field: string, value: string): string {
  if (context.domainState !== undefined) return `this[__state][${JSON.stringify(field)}] = ${value};`;
  const storage = context.managedStorage.get(field);
  return storage === undefined
    ? `Object.defineProperty(this, ${JSON.stringify(field)}, { value: ${value}, writable: false, enumerable: true, configurable: true });`
    : `${managedAccess(context, field)} = ${value};`;
}

function installLifecycleMethod(
  context: LifecycleEmitterContext,
  name: string,
  clock: (() => Date) | undefined,
  body: string
): void {
  const storageEntries = [...context.managedStorage.values()];
  const storageNames = storageEntries.map((entry) => entry.name);
  const storageValues = storageEntries.map((entry) => entry.value);
  const method = globalThis.Function(
    ...storageNames,
    ...(context.domainState === undefined ? [] : ["__state"]),
    ...(clock === undefined ? [] : ["__clock"]),
    `return function() { ${body} };`
  )(
    ...storageValues,
    ...(context.domainState === undefined ? [] : [context.domainState.value]),
    ...(clock === undefined ? [] : [() => checkedClock(clock)])
  ) as Function;
  definePrototype(context.classTarget.prototype, name, method, true);
}

function installTimestampLifecycle(context: LifecycleEmitterContext, lifecycle: LifecycleDefinition): void {
  const timestamps = lifecycle.timestamps;
  const versioned = lifecycle.versioned;
  const clock = timestamps?.clock;
  const field = timestamps?.updatedAt;
  const version = versioned?.field;
  installLifecycleMethod(
    context,
    timestamps?.touchMethod ?? "touch",
    clock,
    `${field === undefined ? "" : `const now = ${clock === undefined ? "new Date()" : "__clock()"}; ${managedWrite(context, field, "now")}`} ${version === undefined ? "" : managedWrite(context, version, `${managedAccess(context, version)} + 1`)}`
  );
}

function installDeletionLifecycle(context: LifecycleEmitterContext, lifecycle: LifecycleDefinition): void {
  const deletion = lifecycle.softDelete;
  if (deletion === undefined) return;
  const timestamps = lifecycle.timestamps;
  const versioned = lifecycle.versioned;
  const timestampField = timestamps?.touch === "manual" || timestamps === undefined ? undefined : timestamps.updatedAt;
  const clock = deletion.clock ?? timestamps?.clock;
  installLifecycleMethod(
    context,
    deletion.deleteMethod,
    clock,
    `if (${managedAccess(context, deletion.field)} !== null) return; const now = ${clock === undefined ? "new Date()" : "__clock()"}; ${managedWrite(context, deletion.field, "now")} ${timestampField === undefined ? "" : managedWrite(context, timestampField, "now")} ${versioned === undefined ? "" : managedWrite(context, versioned.field, `${managedAccess(context, versioned.field)} + 1`)}`
  );
  installLifecycleMethod(
    context,
    deletion.restoreMethod,
    timestampField === undefined ? undefined : clock,
    `if (${managedAccess(context, deletion.field)} === null) return; ${managedWrite(context, deletion.field, "null")} ${timestampField === undefined ? "" : managedWrite(context, timestampField, clock === undefined ? "new Date()" : "__clock()")} ${versioned === undefined ? "" : managedWrite(context, versioned.field, `${managedAccess(context, versioned.field)} + 1`)}`
  );
  Object.defineProperty(context.classTarget.prototype, deletion.isDeletedMember, {
    configurable: true,
    enumerable: false,
    get(this: Record<PropertyKey, unknown>) {
      if (context.domainState !== undefined)
        return (this[context.domainState.value] as Record<string, unknown>)[deletion.field] !== null;
      const deletionStorage = context.managedStorage.get(deletion.field);
      return deletionStorage === undefined ? this[deletion.field] !== null : this[deletionStorage.value] !== null;
    },
  });
}

function installAggregateLifecycle(classTarget: Function): void {
  definePrototype(
    classTarget.prototype,
    "raise",
    function raise(this: { [EVENT_BUFFER]: AnyDomainEvent[] }, event: AnyDomainEvent) {
      this[EVENT_BUFFER][this[EVENT_BUFFER].length] = event;
    },
    true
  );
  definePrototype(
    classTarget.prototype,
    "peekEvents",
    function peekEvents(this: { [EVENT_BUFFER]: AnyDomainEvent[] }) {
      return this[EVENT_BUFFER].slice();
    },
    true
  );
  definePrototype(
    classTarget.prototype,
    "pullEvents",
    function pullEvents(this: { [EVENT_BUFFER]: AnyDomainEvent[] }) {
      const events = this[EVENT_BUFFER];
      this[EVENT_BUFFER] = [];
      return events;
    },
    true
  );
  definePrototype(
    classTarget.prototype,
    "commit",
    async function commit(
      this: { [EVENT_BUFFER]: AnyDomainEvent[] },
      publisher: EventPublisher<AnyDomainEvent>
    ): Promise<void> {
      const pending = this[EVENT_BUFFER];
      for (let index = 0; index < pending.length; index++) await publisher.publish(pending[index]);
      pending.splice(0, pending.length);
    },
    true
  );
}

function checkedClock(clock: () => Date): Date {
  const value = clock();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new JITError("INVALID_OPERATION", "A DDD clock must return a valid Date");
  }
  return value;
}
