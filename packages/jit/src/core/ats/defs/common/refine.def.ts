export interface RefineDef<T> {
  readonly refine: (value: T) => boolean;
}
