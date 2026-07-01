export interface TransformDef {
  readonly transform: <TInput, TOutput>(value: TInput) => TOutput;
}
//used by
//pipe
