export interface Metadata {
  id?: string;
  title?: string;
  description?: string;
  deprecated?: boolean;
  examples?: readonly unknown[];
  tags?: readonly string[];
  custom?: Readonly<Record<string, unknown>>;
}

const compilationSchemas = new WeakMap<object, object>();

/** Keeps documentation-only schema wrappers on the executable cache identity. */
export function rememberDescriptiveMetadata(schema: object, executable: object): void {
  compilationSchemas.set(schema, executable);
}

/** Returns the schema identity whose definition controls executable behavior. */
export function executableSchema(schema: object): object {
  return compilationSchemas.get(schema) ?? schema;
}
