/** Internal composition point for the Runtime Class implementation. */

export { override } from "../classes/override.js";
export type { ClassFactory } from "./class-core-factory.js";
export { classType, classType as class } from "./class-core-factory.js";
export { classMixin } from "./class-core-mixin.js";
export { createRuntimeClass, getRuntimeClassTarget } from "./class-core-runtime.js";
export { createScalarValueObject } from "./class-core-scalar.js";
export { isIdentifierSchema } from "./class-core-schema.js";
export { capability, definePrototype, installFactory, removeFactorySurface } from "./class-core-support.js";
export { CLASS_TARGET } from "./class-core-symbols.js";
