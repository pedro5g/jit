import type { ClassFactoryMemberDescriptor, ClassMemberDescriptor } from "../classes/member-descriptors.js";
import { isClassMemberDescriptor } from "../classes/member-descriptors.js";
import { compileValidator } from "../compiler/validate.js";
import type * as ATS from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import type { ClassMethodDefinition } from "./class-core-state.js";
import type { CallableClassCapability, RuntimeClass } from "./class-types.js";

/** @internal Installs or removes one named factory on a Runtime Class. */
export function installFactory<TSchema extends ATS.AnyTypeSchema>(
  classTarget: RuntimeClass<TSchema>,
  previous: string | false,
  next: string | false,
  factory: Function
): void {
  if (previous !== false && previous !== next) {
    delete (classTarget as unknown as Record<string, unknown>)[previous];
  }
  if (next === false) return;
  if (
    next === "schema" ||
    next === "use" ||
    next === "extends" ||
    next === "factories" ||
    next === "construction" ||
    next === "accessors" ||
    next === "validate" ||
    next === "assert"
  ) {
    throw new JITError("INVALID_OPERATION", `Factory name ${JSON.stringify(next)} is reserved`);
  }
  Object.defineProperty(classTarget, next, {
    configurable: true,
    enumerable: false,
    value: factory,
  });
}

/** @internal Removes factory names when a preset owns a different boundary. */
export function removeFactorySurface(runtime: Function, names: readonly string[]): void {
  const surface = runtime as unknown as Record<string, unknown>;
  for (const name of names) delete surface[name];
}

/** @internal Resolves a fluent factory descriptor against its current name. */
export function resolveFactoryOption(
  option: string | false | ClassMemberDescriptor<ClassFactoryMemberDescriptor> | undefined,
  previous: string | false,
  phase: "create" | "hydrate"
): { readonly name: string | false; readonly implementation?: Function } {
  if (option === undefined) return { name: previous };
  if (typeof option === "object") {
    if (!isClassMemberDescriptor(option) || option.definition.kind !== "factory") {
      throw new JITError("CLASS_FACTORY_CONFLICT", "Invalid class factory descriptor");
    }
    if (option.definition.phase !== phase) {
      throw new JITError(
        "CLASS_FACTORY_CONFLICT",
        `A ${option.definition.phase} factory descriptor cannot configure ${phase}`
      );
    }
    return { name: option.definition.name, implementation: option.definition.implementation };
  }
  return { name: option };
}

/** @internal Creates an immutable prototype capability descriptor. */
export function capability<TMethods extends object>(
  kind: string,
  install: (prototype: object, schema: ATS.AnyTypeSchema) => void,
  memberNames: readonly string[] = [kind]
): CallableClassCapability<TMethods> {
  let callable: CallableClassCapability<TMethods>;
  callable = (() => callable) as CallableClassCapability<TMethods>;
  Object.defineProperties(callable, {
    kind: { enumerable: true, value: kind },
    __memberNames: { enumerable: false, value: Object.freeze([...memberNames]) },
    install: {
      enumerable: false,
      value: (classTarget: Function, schema: ATS.AnyTypeSchema) => {
        install(classTarget.prototype, schema);
      },
    },
  });
  return Object.freeze(callable);
}

/** @internal Defines a stable non-enumerable prototype method. */
export function definePrototype(prototype: object, key: string, value: Function, configurable = false): void {
  Object.defineProperty(prototype, key, {
    configurable,
    enumerable: false,
    value,
    writable: false,
  });
}

/** @internal Installs a method descriptor, compiling its optional contract once. */
export function installMethodDefinition(classTarget: Function, method: ClassMethodDefinition): void {
  let source = method.source;
  if (method.schema !== undefined) {
    const args = compileValidator(method.schema.def.args);
    const output = method.schema.def.output === undefined ? undefined : compileValidator(method.schema.def.output);
    if (method.async === true) {
      source = async function validatedAsyncMethod(this: unknown, ...rawArgs: unknown[]) {
        const parsed = args.parse(rawArgs) as readonly unknown[];
        const result = await method.source.apply(this, parsed as never[]);
        return output === undefined ? result : output.parseAsync(result);
      };
    } else {
      source = function validatedMethod(this: unknown, ...rawArgs: unknown[]) {
        const parsed = args.parse(rawArgs) as readonly unknown[];
        const result = method.source.apply(this, parsed as never[]);
        return output === undefined ? result : output.parse(result);
      };
    }
  }
  const descriptor: PropertyDescriptor =
    method.kind === "method"
      ? { value: source, writable: false }
      : method.kind === "get"
        ? { get: source as () => unknown }
        : { set: source as (value: unknown) => void };
  Object.defineProperty(classTarget.prototype, method.name, {
    ...descriptor,
    configurable: true,
    enumerable: false,
  });
}
