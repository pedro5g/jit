import * as ATS from "../../core/ats/index.js";

type InnerWrappedSchema = ATS.AnyTypeSchema & { readonly def: ATS.InnerTypeDef<ATS.AnyTypeSchema> };
type LazyWrappedSchema = ATS.AnyTypeSchema & { readonly def: ATS.LazyDef<ATS.AnyTypeSchema> };

export interface ResolvedWrappers {
  readonly base: ATS.AnyTypeSchema;
  readonly optional: boolean;
  readonly nullable: boolean;
}

export function resolveWrappers(schema: ATS.AnyTypeSchema): ResolvedWrappers {
  let current = schema;
  let optional = false;
  let nullable = false;

  while (true) {
    if (current.type === ATS.TypeName.optional) {
      optional = true;
      current = innerType(current);
      continue;
    }

    if (current.type === ATS.TypeName.nullable) {
      nullable = true;
      current = innerType(current);
      continue;
    }

    if (current.type === ATS.TypeName.nullish) {
      optional = true;
      nullable = true;
      current = innerType(current);
      continue;
    }

    if (
      current.type === ATS.TypeName.default ||
      current.type === ATS.TypeName.brand ||
      current.type === ATS.TypeName.pipe ||
      current.type === ATS.TypeName.readonly ||
      current.type === ATS.TypeName.refine ||
      current.type === ATS.TypeName.coerce
    ) {
      current = innerType(current);
      continue;
    }

    if (current.type === ATS.TypeName.lazy) {
      current = (current as LazyWrappedSchema).def.getter();
      continue;
    }

    break;
  }

  return {
    base: current,
    optional,
    nullable,
  };
}

function innerType(schema: ATS.AnyTypeSchema): ATS.AnyTypeSchema {
  return (schema as InnerWrappedSchema).def.innerType;
}
