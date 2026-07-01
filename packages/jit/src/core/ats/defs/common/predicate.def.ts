export interface PredicateDef {
  readonly predicate: <TValue>(value: TValue) => boolean;
}
//used by
//refine
