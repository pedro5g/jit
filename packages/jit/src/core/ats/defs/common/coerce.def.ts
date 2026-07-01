export interface CoerceDef {
  readonly coerce?: true | ((value: unknown) => unknown);
}
