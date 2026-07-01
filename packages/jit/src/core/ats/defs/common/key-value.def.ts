import type { TypeSchema } from "../../index.js";

export interface KeyValueDef {
  readonly key: TypeSchema;
  readonly value: TypeSchema;
}
//used by
//map/record
