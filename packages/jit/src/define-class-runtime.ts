import {
  classFactory as classFactoryDescriptor,
  classGetter,
  classMethod,
  classNoConstructor,
  classPrivate,
  classProtected,
  classPublic,
  classSetter,
} from "./classes/member-descriptors.js";
import { override } from "./classes/override.js";
import type { SchemaInput } from "./core/builder/index.js";
import { unwrapSchema } from "./core/builder/index.js";
import { defineRuntimeClass } from "./define-class-materialize.js";
import { defineCapability, defineClassState } from "./define-class-state.js";
import type { ClassFactory, ClassJsonCapability, ClassJsonOptions } from "./factories/class.js";
import { classMixin } from "./factories/class.js";

export { defineClassExtensions } from "./define-class-extensions.js";
export { defineRuntimeClass } from "./define-class-materialize.js";
export type {
  DefinedCapability,
  DefinedClassAssertionFailure,
  DefinedClassAssertions,
  DefinedClassFieldPolicy,
  DefinedClassMethod,
  DefinedClassPolicy,
  DefinedClassState,
} from "./define-class-state.js";
export { defineCapability, defineClassState } from "./define-class-state.js";

export const defineClass = Object.assign(
  ((schema: SchemaInput<import("./core/ats/index.js").AnyTypeSchema>) =>
    defineRuntimeClass(defineClassState(unwrapSchema(schema), false, false))) as ClassFactory,
  {
    abstract: (schema: SchemaInput<import("./core/ats/index.js").AnyTypeSchema>) =>
      defineRuntimeClass(defineClassState(unwrapSchema(schema), true, false)),
    equals: defineCapability("equals", ["equals"]),
    hashCode: defineCapability("hashCode", ["hashCode"]),
    with: defineCapability("with", ["with"]),
    diff: defineCapability("diff", ["diff"]),
    clone: defineCapability("clone", ["clone"]),
    override,
    public: classPublic,
    protected: classProtected,
    private: classPrivate,
    getter: classGetter,
    setter: classSetter,
    method: classMethod,
    factory: classFactoryDescriptor,
    noConstructor: classNoConstructor,
    mixin: classMixin,
    json: (options?: ClassJsonOptions) =>
      defineCapability("class.json", [options?.method ?? "toJson"]) as ClassJsonCapability,
  }
) as ClassFactory;
