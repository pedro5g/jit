export type Bind<T> = { kind?: T };
export interface Equal<in T> extends Bind<Equal<T>> {
  (left: T, right: T): boolean;
}
export type Scope = {
  bindings: Map<string, string>;
  isOptional: boolean;
};

export type Builder = (left: Path, right: Path, ix: Scope) => string;

export type Path = (string | number)[];
export type Nullable<T> = T extends object ? { [K in keyof T]: T[K] | null } : T | null;

type LiteralValue = string | number | boolean;

export type Literal<T extends any | readonly any[]> = T extends readonly LiteralValue[]
  ? [T[number]]
  : T extends LiteralValue
    ? T
    : never;
