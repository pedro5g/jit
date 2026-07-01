export interface DefaultValueDef<T> {
  readonly defaultValue: T | (() => T);
}
//used by
//default
