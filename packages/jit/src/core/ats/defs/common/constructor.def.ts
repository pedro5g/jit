export interface ConstructorDef {
  readonly ctor: abstract new (...args: readonly any[]) => unknown;
}
//used by
//instanceof
