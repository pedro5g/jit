/**
 * Runtime helpers referenced by generated (AOT) code. Kept tiny and
 * dependency-free so bundlers can tree-shake everything else away.
 */
/** Links a compiled artifact back to the schema/plan that produced it. */
export { type CompiledArtifact, getArtifact } from "./artifact-registry.js";
export * from "./cache/index.js";
export * from "./hash/index.js";
export * from "./index/index.js";
