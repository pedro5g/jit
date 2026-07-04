import { createSchema, type EmptyDef, type FileSchema, TypeName } from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder } from "../../core/builder/index.js";
import { emptyDef } from "./empty-def.js";

/**
 * Creates a `File` schema builder.
 *
 * @returns A builder wrapping a File schema.
 */
export function file(): Builder<FileSchema> {
  return /* @__PURE__ */ createBuilder(createSchema<File, "file", EmptyDef>(TypeName.file, emptyDef));
}
