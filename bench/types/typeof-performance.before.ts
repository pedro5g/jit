import type { AnyTypeSchema, TypeofSchema } from "../../packages/jit/src/core/ats/type-schema.js";
import type {
  CollectionSchema,
  DepthSchemas,
  LargeUnion,
  RuntimeTypeSchema,
  Schema10,
  Schema25,
  Schema50,
  Schema100,
} from "./typeof-performance.fixture.js";

type LegacyTypeof<TSchemaLike> = TSchemaLike extends { readonly schema: infer TSchema extends AnyTypeSchema }
  ? TypeofSchema<TSchema>
  : TSchemaLike extends AnyTypeSchema
    ? TypeofSchema<TSchemaLike>
    : never;

export type LegacyWidths = [
  LegacyTypeof<typeof Schema10>,
  LegacyTypeof<typeof Schema25>,
  LegacyTypeof<typeof Schema50>,
  LegacyTypeof<typeof Schema100>,
];
export type LegacyDepths = [
  LegacyTypeof<(typeof DepthSchemas)[0]>,
  LegacyTypeof<(typeof DepthSchemas)[1]>,
  LegacyTypeof<(typeof DepthSchemas)[2]>,
  LegacyTypeof<(typeof DepthSchemas)[3]>,
];
export type LegacyUnion = LegacyTypeof<typeof LargeUnion>;
export type LegacyCollections = LegacyTypeof<typeof CollectionSchema>;
export type LegacyRuntimeType = LegacyTypeof<typeof RuntimeTypeSchema>;
