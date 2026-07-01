import type { TypeSchema } from "../../index.js";

export interface PropsDef {
  readonly props: Readonly<Record<string, TypeSchema>>;
}
//used by
//object
