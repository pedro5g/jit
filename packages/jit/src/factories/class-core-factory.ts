import {
  classFactory as classFactoryDescriptor,
  classGetter,
  classMethod,
  classNoConstructor,
  classPrivate,
  classProtected,
  classPublic,
  classSetter,
} from "../classes/member-descriptors.js";
import { override } from "../classes/override.js";
import { compileCloneMethod } from "../compiler/clone.js";
import { compileDiffMethod } from "../compiler/diff.js";
import { compileEqualMethod } from "../compiler/equal.js";
import { compileHashMethod } from "../compiler/hash.js";
import { compileUpdate, type UpdatePatch } from "../compiler/index.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import { classMixin } from "./class-core-mixin.js";
import { abstractClass, classFactory, isFailure } from "./class-core-runtime.js";
import { capability, definePrototype } from "./class-core-support.js";
import { INTERNAL_CONSTRUCT } from "./class-layout.js";
import type {
  AbstractRuntimeClass,
  CallableClassCapability,
  ClassCloneCapability,
  ClassJsonCapability,
  ClassJsonOptions,
  ClassWithCapability,
  DiffMethods,
  EqualsMethods,
  HashCodeMethods,
} from "./class-types.js";

/** Runtime Class factory and built-in prototype capabilities. */
export interface ClassFactory {
  /** Creates a constructor-first Runtime Class from a schema. */
  <TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>
  ): import("./class-types.js").ConstructorRuntimeClass<TSchema>;
  /** Creates an abstract Runtime Class base from a schema. */
  abstract<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): AbstractRuntimeClass<TSchema>;
  readonly equals: CallableClassCapability<EqualsMethods>;
  readonly hashCode: CallableClassCapability<HashCodeMethods>;
  readonly with: ClassWithCapability;
  readonly diff: CallableClassCapability<DiffMethods>;
  /** Copies an instance's state through the shared clone plan. */
  readonly clone: ClassCloneCapability;
  readonly override: typeof override;
  readonly public: typeof classPublic;
  readonly protected: typeof classProtected;
  readonly private: typeof classPrivate;
  readonly getter: typeof classGetter;
  readonly setter: typeof classSetter;
  readonly method: typeof classMethod;
  readonly factory: typeof classFactoryDescriptor;
  readonly noConstructor: typeof classNoConstructor;
  readonly mixin: typeof classMixin;
  readonly json: <const TOptions extends ClassJsonOptions = {}>(options?: TOptions) => ClassJsonCapability<TOptions>;
  readonly isFailure: typeof isFailure;
}

/** Runtime type factory. Capabilities are installed separately on the prototype. */
export const classType: ClassFactory = Object.assign(classFactory, {
  abstract: abstractClass,
  equals: capability<EqualsMethods>("equals", (prototype, schema) => {
    definePrototype(prototype, "equals", compileEqualMethod(schema), true);
  }),
  hashCode: capability<HashCodeMethods>("hashCode", (prototype, schema) => {
    definePrototype(prototype, "hashCode", compileHashMethod(schema), true);
  }),
  with: (() => {
    const base = capability<object>("with", (prototype, schema) => {
      const update = compileUpdate(schema);
      definePrototype(
        prototype,
        "with",
        function withPatch(this: object, patch: UpdatePatch<unknown>) {
          const next = update(this, patch);
          return new (this.constructor as new (state: object, token: symbol) => object)(
            next as object,
            INTERNAL_CONSTRUCT
          );
        },
        true
      );
    });
    return base as ClassWithCapability;
  })(),
  diff: capability<DiffMethods>("diff", (prototype, schema) => {
    definePrototype(prototype, "diff", compileDiffMethod(schema), true);
  }),
  clone: (() => {
    const base = capability<object>("clone", (prototype, schema) => {
      definePrototype(prototype, "clone", compileCloneMethod(schema), true);
    });
    return base as ClassCloneCapability;
  })(),
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
  json<const TOptions extends ClassJsonOptions = {}>(options?: TOptions): ClassJsonCapability<TOptions> {
    const method = options?.method ?? "toJson";
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(method)) {
      throw new JITError("INVALID_OPERATION", `Invalid class JSON method name ${JSON.stringify(method)}`);
    }
    return Object.freeze({
      kind: "class.json" as const,
      __options: (options ?? {}) as TOptions,
      __memberNames: Object.freeze([method]),
      install() {},
    }) as ClassJsonCapability<TOptions>;
  },
  isFailure,
});

/** Declares that a class extension intentionally replaces an inherited member. */
export { classType as class, override };
