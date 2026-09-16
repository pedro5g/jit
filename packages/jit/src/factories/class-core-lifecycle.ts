import type { LifecycleDefinition } from "../classes/effective-schema.js";
import { JITError } from "../errors/index.js";
import type { ClassDefinitionState } from "./class-core-state.js";
import { definePrototype } from "./class-core-support.js";
import type { ManagedStorageBinding } from "./class-layout.js";
import { EVENT_BUFFER } from "./class-layout.js";
import type { AnyDomainEvent, EventPublisher } from "./class-types.js";

export function lifecycleArtifact(lifecycle: LifecycleDefinition):
  | {
      readonly updatedAt?: string;
      readonly touchAt?: string;
      readonly version?: string;
      readonly deletedAt?: string;
      readonly timestampClock?: unknown;
      readonly deletionClock?: unknown;
      readonly touchMethod?: string;
      readonly deleteMethod?: string;
      readonly restoreMethod?: string;
      readonly isDeletedMember?: string;
    }
  | undefined {
  const timestamps = lifecycle.timestamps;
  const deletion = lifecycle.softDelete;
  const versioned = lifecycle.versioned;
  if (timestamps === undefined && deletion === undefined && versioned === undefined) return undefined;
  return {
    ...(timestamps?.touch === "manual" || timestamps === undefined ? {} : { updatedAt: timestamps.updatedAt }),
    ...(timestamps === undefined ? {} : { touchAt: timestamps.updatedAt, touchMethod: timestamps.touchMethod }),
    ...(versioned === undefined ? {} : { version: versioned.field }),
    ...(deletion === undefined
      ? {}
      : {
          deletedAt: deletion.field,
          deleteMethod: deletion.deleteMethod,
          restoreMethod: deletion.restoreMethod,
          isDeletedMember: deletion.isDeletedMember,
        }),
    ...(timestamps?.clock === undefined ? {} : { timestampClock: timestamps.clock }),
    ...(deletion?.clock === undefined ? {} : { deletionClock: deletion.clock }),
  };
}

export function installLifecycleMethods(
  classTarget: Function,
  state: ClassDefinitionState,
  managedStorage: ReadonlyMap<string, ManagedStorageBinding>,
  domainState: ManagedStorageBinding | undefined
): void {
  const lifecycle = state.lifecycle;
  const timestamps = lifecycle.timestamps;
  const deletion = lifecycle.softDelete;
  const versioned = lifecycle.versioned;
  const managedAccess = (field: string): string => {
    if (domainState !== undefined) return `this[__state][${JSON.stringify(field)}]`;
    const storage = managedStorage.get(field);
    return storage === undefined ? `this[${JSON.stringify(field)}]` : `this[${storage.name}]`;
  };
  const managedWrite = (field: string, value: string): string => {
    if (domainState !== undefined) return `this[__state][${JSON.stringify(field)}] = ${value};`;
    const storage = managedStorage.get(field);
    return storage === undefined
      ? `Object.defineProperty(this, ${JSON.stringify(field)}, { value: ${value}, writable: false, enumerable: true, configurable: true });`
      : `${managedAccess(field)} = ${value};`;
  };
  const installLifecycleMethod = (name: string, clock: (() => Date) | undefined, body: string): void => {
    const source = `return function() { ${body} };`;
    const storageEntries = [...managedStorage.values()];
    const storageNames = storageEntries.map((entry) => entry.name);
    const storageValues = storageEntries.map((entry) => entry.value);
    const method = globalThis.Function(
      ...storageNames,
      ...(domainState === undefined ? [] : ["__state"]),
      ...(clock === undefined ? [] : ["__clock"]),
      source
    )(
      ...storageValues,
      ...(domainState === undefined ? [] : [domainState.value]),
      ...(clock === undefined ? [] : [() => checkedClock(clock)])
    ) as Function;
    definePrototype(classTarget.prototype, name, method, true);
  };

  if (timestamps !== undefined || versioned !== undefined) {
    const clock = timestamps?.clock;
    const field = timestamps?.updatedAt;
    const version = versioned?.field;
    installLifecycleMethod(
      timestamps?.touchMethod ?? "touch",
      clock,
      `${field === undefined ? "" : `const now = ${clock === undefined ? "new Date()" : "__clock()"}; ${managedWrite(field, "now")}`} ${version === undefined ? "" : managedWrite(version, `${managedAccess(version)} + 1`)}`
    );
  }

  if (deletion !== undefined) {
    const timestampField =
      timestamps?.touch === "manual" || timestamps === undefined ? undefined : timestamps.updatedAt;
    const clock = deletion.clock ?? timestamps?.clock;
    installLifecycleMethod(
      deletion.deleteMethod,
      clock,
      `if (${managedAccess(deletion.field)} !== null) return; const now = ${clock === undefined ? "new Date()" : "__clock()"}; ${managedWrite(deletion.field, "now")} ${timestampField === undefined ? "" : managedWrite(timestampField, "now")} ${versioned === undefined ? "" : managedWrite(versioned.field, `${managedAccess(versioned.field)} + 1`)}`
    );
    installLifecycleMethod(
      deletion.restoreMethod,
      timestampField === undefined ? undefined : clock,
      `if (${managedAccess(deletion.field)} === null) return; ${managedWrite(deletion.field, "null")} ${timestampField === undefined ? "" : managedWrite(timestampField, clock === undefined ? "new Date()" : "__clock()")} ${versioned === undefined ? "" : managedWrite(versioned.field, `${managedAccess(versioned.field)} + 1`)}`
    );
    Object.defineProperty(classTarget.prototype, deletion.isDeletedMember, {
      configurable: true,
      enumerable: false,
      get(this: Record<PropertyKey, unknown>) {
        if (domainState !== undefined)
          return (this[domainState.value] as Record<string, unknown>)[deletion.field] !== null;
        const deletionStorage = managedStorage.get(deletion.field);
        return deletionStorage === undefined ? this[deletion.field] !== null : this[deletionStorage.value] !== null;
      },
    });
  }

  if (state.aggregate) {
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
}

function checkedClock(clock: () => Date): Date {
  const value = clock();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new JITError("INVALID_OPERATION", "A DDD clock must return a valid Date");
  }
  return value;
}
