import type * as ATS from "../../core/ats/index.js";
import type { SchemaInput } from "../../core/builder/index.js";
import { JIT } from "../../index.js";

/** Builds the public validation capabilities used by compiler behavior tests. */
export function validation<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
  return {
    is: JIT.is(schema),
    parse: JIT.parse(schema),
    safeParse: JIT.safeParse(schema),
    parseAsync: JIT.validate.parseAsync(schema),
    safeParseAsync: JIT.validate.safeParseAsync(schema),
  } as const;
}
