export interface Check<TKind extends string, TValue = unknown> {
  readonly kind: TKind;
  readonly value?: TValue;
}
