import type { TypeSchema } from "../../index.js";

export interface BinaryDef {
  readonly left: TypeSchema;
  readonly right: TypeSchema;
}
//used by
//intersection
