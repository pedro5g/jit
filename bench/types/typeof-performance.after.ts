import type { JIT } from "../../packages/jit/src/index.js";
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

export type ResolvedWidths = [
  JIT.Typeof<typeof Schema10>,
  JIT.Typeof<typeof Schema25>,
  JIT.Typeof<typeof Schema50>,
  JIT.Typeof<typeof Schema100>,
];
export type ResolvedDepths = [
  JIT.Typeof<(typeof DepthSchemas)[0]>,
  JIT.Typeof<(typeof DepthSchemas)[1]>,
  JIT.Typeof<(typeof DepthSchemas)[2]>,
  JIT.Typeof<(typeof DepthSchemas)[3]>,
];
export type ResolvedUnion = JIT.Typeof<typeof LargeUnion>;
export type ResolvedCollections = JIT.Typeof<typeof CollectionSchema>;
export type ResolvedRuntimeType = JIT.Typeof<typeof RuntimeTypeSchema>;
