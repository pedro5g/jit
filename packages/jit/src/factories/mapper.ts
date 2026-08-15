type RequiredKeys<TValue> = {
  [TKey in keyof TValue]-?: undefined extends TValue[TKey] ? never : TKey;
}[keyof TValue];

type AutoMatchedKeys<TSource, TTarget> = {
  [TKey in keyof TTarget]-?: TKey extends keyof TSource ? (TSource[TKey] extends TTarget[TKey] ? TKey : never) : never;
}[keyof TTarget];

type RequiredOverrideKeys<TSource, TTarget> = Exclude<RequiredKeys<TTarget>, AutoMatchedKeys<TSource, TTarget>>;

type RenameSources<TSource, TValue> = {
  [TFrom in keyof TSource]-?: TSource[TFrom] extends TValue ? TFrom : never;
}[keyof TSource];

/**
 * One target-field mapping rule: a computed callback, a rename, a
 * rename-and-convert, or a default for missing values.
 */
export type MapperOverride<TSource, TValue> =
  | ((source: TSource) => TValue)
  | {
      readonly from: RenameSources<TSource, TValue>;
      readonly via?: never;
      readonly default?: never;
    }
  | {
      [TFrom in keyof TSource]-?: {
        readonly from: TFrom;
        readonly via: (value: TSource[TFrom], source: TSource) => TValue;
        readonly default?: never;
      };
    }[keyof TSource]
  | { readonly default: TValue; readonly from?: never; readonly via?: never };

/**
 * Override map for `JIT.map()`: target fields with no compatible same-name
 * source field are required; auto-matched fields may still be overridden.
 */
export type MapperOverrides<TSource, TTarget> = {
  readonly [TKey in RequiredOverrideKeys<TSource, TTarget>]: MapperOverride<TSource, TTarget[TKey]>;
} & {
  readonly [TKey in Exclude<keyof TTarget, RequiredOverrideKeys<TSource, TTarget>>]?: MapperOverride<
    TSource,
    TTarget[TKey]
  >;
};

/**
 * Trailing argument list for the mapper factories. When every required target
 * field is auto-matched by name and type, the overrides argument disappears
 * from the signature entirely — `JIT.map(User, PublicUser)` is complete. It
 * becomes required again as soon as one target field cannot be inferred, and
 * the error then points at exactly the fields that need a rule.
 */
export type MapperArgs<TSource, TTarget> = [RequiredOverrideKeys<TSource, TTarget>] extends [never]
  ? [overrides?: MapperOverrides<TSource, TTarget>]
  : [overrides: MapperOverrides<TSource, TTarget>];
