import type { TypeSchema } from "../../index.js";

export interface GetterDef {
  readonly getter: () => TypeSchema;
}
//used by
//lazy
