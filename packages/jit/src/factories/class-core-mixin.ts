import { JITError } from "../errors/index.js";
import { CLASS_MIXIN } from "./class-extensions.js";
import type { ClassMethodsInput, ClassMixin, ClassMixinDefinition, MixinThisSurface } from "./class-types.js";

/**
 * Creates a reusable structural extension for `.extends()`.
 *
 * @example
 * ```ts
 * const Audited = JIT.class.mixin({ methods: { touch() { this.updatedAt = new Date(); } } });
 * const Model = JIT.class(JIT.object({ updatedAt: JIT.date() })).extends(Audited);
 * ```
 */
export function classMixin<
  const TRequires extends ClassMethodsInput = {},
  const TFields extends ClassMethodsInput = {},
  const TMethods extends ClassMethodsInput = {},
>(definition: {
  readonly requires?: TRequires;
  readonly fields?: TFields;
  readonly methods?: TMethods & ThisType<MixinThisSurface<TFields, TRequires>>;
}): ClassMixin<TFields & TMethods, TRequires>;
/** Creates a reusable structural class extension with shared methods. */
export function classMixin(definition: ClassMixinDefinition): ClassMixin {
  const fieldNames = new Set(Object.getOwnPropertyNames(definition.fields ?? {}));
  const methodNames = Object.getOwnPropertyNames(definition.methods ?? {});
  if (methodNames.some((name) => fieldNames.has(name))) {
    throw new JITError(
      "CLASS_MEMBER_ALREADY_EXISTS",
      "A class mixin cannot declare the same member as a field and method"
    );
  }
  const mixin = (() => Object.freeze({ ...(definition.fields ?? {}), ...(definition.methods ?? {}) })) as ClassMixin;
  Object.defineProperties(mixin, {
    [CLASS_MIXIN]: { enumerable: false, value: true },
    __classMixin: { enumerable: false, value: true },
    __requires: { enumerable: false, value: definition.requires ?? {} },
  });
  return Object.freeze(mixin);
}
