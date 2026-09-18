import { JITError } from "../errors/index.js";
import type { ClassFactoryMemberDescriptor, ClassMemberDescriptor } from "./member-descriptors.js";
import { isClassMemberDescriptor } from "./member-descriptors.js";

/** Resolves a factory descriptor against its current public name. */
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
