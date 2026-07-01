import type { TypeSchema } from "../../index.js";

export interface TupleItemsDef {
  readonly items: readonly TypeSchema[];
  readonly rest?: TypeSchema;
}
//used by
//tuple
