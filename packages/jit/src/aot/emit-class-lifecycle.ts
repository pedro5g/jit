import type { ClassArtifactStorage } from "./emit-class-members.js";
import type { ClassArtifactSetup } from "./emit-class-setup.js";
import type { ClassArtifactEmitContext } from "./emit-class-types.js";

type ClassArtifact = ClassArtifactSetup["artifact"];

/** Emits aggregate event and managed timestamp/version lifecycle methods. */
export function emitClassLifecycleMembers(
  context: ClassArtifactEmitContext,
  setup: ClassArtifactSetup,
  storage: ClassArtifactStorage
): readonly string[] {
  const methods: string[] = [];
  if (setup.artifact.aggregate) methods.push(...aggregateMethods(storage.eventBufferKey));
  const mutation = setup.artifact.mutation;
  if (mutation?.deletedAt !== undefined) methods.push(...deletedMutationMethods(context, mutation, storage));
  if (mutation?.touchAt !== undefined || mutation?.version !== undefined)
    methods.push(touchMutationMethod(context, mutation, storage));
  if (storage.domainStateKey !== undefined) methods.push(`get _props() { return this[${storage.domainStateKey}]; }`);
  return methods;
}

function aggregateMethods(eventBufferKey: string | undefined): readonly string[] {
  return [
    `raise(event) { this[${eventBufferKey}].push(event); }`,
    `peekEvents() { return this[${eventBufferKey}].slice(); }`,
    `pullEvents() { const events = this[${eventBufferKey}]; this[${eventBufferKey}] = []; return events; }`,
    `async commit(publisher) { const pending = this[${eventBufferKey}]; for (let index = 0; index < pending.length; index++) await publisher.publish(pending[index]); pending.splice(0, pending.length); }`,
  ];
}

function deletedMutationMethods(
  context: ClassArtifactEmitContext,
  mutation: NonNullable<ClassArtifact["mutation"]>,
  storage: ClassArtifactStorage
): readonly string[] {
  const deletedAt = mutation.deletedAt as string;
  const deleteMethod = context.classMemberName(mutation.deleteMethod ?? "softDelete");
  const restoreMethod = context.classMemberName(mutation.restoreMethod ?? "restore");
  const isDeletedMember = context.classMemberName(mutation.isDeletedMember ?? "isDeleted");
  return [
    deleteMutationSource(deleteMethod, mutation, deletedAt, storage),
    restoreMutationSource(restoreMethod, mutation, deletedAt, storage),
    `get ${isDeletedMember}() { return ${storage.readField(deletedAt)} !== null; }`,
  ];
}

function deleteMutationSource(
  method: string,
  mutation: NonNullable<ClassArtifact["mutation"]>,
  deletedAt: string,
  storage: ClassArtifactStorage
): string {
  const updatedAt = mutation.updatedAt;
  const version = mutation.version;
  const updated = updatedAt === undefined ? "" : ` ${storage.writeField(updatedAt, "now")}`;
  const incremented =
    version === undefined ? "" : ` ${storage.writeField(version, `${storage.readField(version)} + 1`)}`;
  return `${method}() { if (${storage.readField(deletedAt)} !== null) return; const now = new Date(); ${storage.writeField(deletedAt, "now")}${updated}${incremented} }`;
}

function restoreMutationSource(
  method: string,
  mutation: NonNullable<ClassArtifact["mutation"]>,
  deletedAt: string,
  storage: ClassArtifactStorage
): string {
  const updatedAt = mutation.updatedAt;
  const version = mutation.version;
  const updated = updatedAt === undefined ? "" : ` const now = new Date(); ${storage.writeField(updatedAt, "now")}`;
  const incremented =
    version === undefined ? "" : ` ${storage.writeField(version, `${storage.readField(version)} + 1`)}`;
  return `${method}() { if (${storage.readField(deletedAt)} === null) return; ${storage.writeField(deletedAt, "null")}${updated}${incremented} }`;
}

function touchMutationMethod(
  context: ClassArtifactEmitContext,
  mutation: NonNullable<ClassArtifact["mutation"]>,
  storage: ClassArtifactStorage
): string {
  const touchAt = mutation.touchAt;
  const version = mutation.version;
  const touched = touchAt === undefined ? "" : `const now = new Date(); ${storage.writeField(touchAt, "now")}`;
  const incremented = version === undefined ? "" : storage.writeField(version, `${storage.readField(version)} + 1`);
  return `${context.classMemberName(mutation.touchMethod ?? "touch")}() { ${touched} ${incremented} }`;
}
