import type * as ATS from "../../core/ats/index.js";
import type { SchemaInput } from "../../core/builder/index.js";
import { JIT } from "../../index.js";

/** Builds the public validation capabilities used by compiler behavior tests. */
export function validation<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
  return {
    is: JIT.validate.is(schema),
    parse: JIT.validate.parse(schema),
    safeParse: JIT.validate.safeParse(schema),
    async: {
      parse: JIT.validate.async.parse(schema),
      safeParse: JIT.validate.async.safeParse(schema),
    },
  } as const;
}
