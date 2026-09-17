import { type ClassMemberDefinition, isClassMemberDescriptor } from "../classes/member-descriptors.js";
import { isOverrideDescriptor } from "../classes/override.js";
import type * as ATS from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import type { ClassMethodDefinition, InstalledScalarMethod } from "./class-core-state.js";
import { installMethodDefinition } from "./class-core-support.js";
import { RESERVED_EXTENSION_NAMES, SCALAR_MEMBERS } from "./class-extensions.js";
import type { ClassMethodsInput } from "./class-types.js";

export function installScalarExtension(
  classTarget: Function,
  extension: ClassMethodsInput,
  installedMethods: InstalledScalarMethod[],
  installedMethodNames: Set<string>
): void {
  for (const name of Object.getOwnPropertyNames(extension)) {
    const property = Object.getOwnPropertyDescriptor(extension, name);
    if (property === undefined) continue;
    const value = property.value;
    if (isOverrideDescriptor(value)) {
      applyScalarOverride(classTarget, name, value.value, installedMethods, installedMethodNames);
      continue;
    }
    assertNewScalarMember(name, installedMethodNames);
    if (isClassMemberDescriptor(value)) installScalarDescriptor(classTarget, name, value.definition, installedMethods);
    else {
      const recorded = installMethods(classTarget, { [name]: value }, SCALAR_MEMBERS, installedMethodNames);
      installedMethods.push(...recorded);
    }
    installedMethodNames.add(name);
  }
}

function applyScalarOverride(
  classTarget: Function,
  name: string,
  replacement: unknown,
  installedMethods: InstalledScalarMethod[],
  installedMethodNames: Set<string>
): void {
  if (!installedMethodNames.has(name) || SCALAR_MEMBERS.has(name)) {
    throw new JITError(
      "CLASS_OVERRIDE_TARGET_NOT_FOUND",
      `Scalar member ${JSON.stringify(name)} does not have an overridable custom declaration`
    );
  }
  if (isClassMemberDescriptor(replacement)) {
    installScalarDescriptor(classTarget, name, replacement.definition, installedMethods);
  } else if (typeof replacement === "function") {
    installScalarMethod(classTarget, { name, kind: "method", source: replacement }, installedMethods);
  } else {
    throw new JITError("CLASS_MEMBER_ALREADY_EXISTS", `Scalar member ${JSON.stringify(name)} must be a method`);
  }
}

function assertNewScalarMember(name: string, installedMethodNames: ReadonlySet<string>): void {
  if (SCALAR_MEMBERS.has(name) || installedMethodNames.has(name)) {
    throw new JITError(
      "CLASS_MEMBER_ALREADY_EXISTS",
      `Scalar member ${JSON.stringify(name)} would shadow an existing member; use JIT.class.override(...) explicitly`
    );
  }
}

function installMethods(
  classTarget: Function,
  methods: ClassMethodsInput,
  taken: ReadonlySet<string>,
  installed: Set<string>
): InstalledScalarMethod[] {
  const recorded: InstalledScalarMethod[] = [];
  for (const name of Object.getOwnPropertyNames(methods)) {
    assertMethodNameAvailable(name, taken, installed);
    const descriptor = Object.getOwnPropertyDescriptor(methods, name);
    if (descriptor === undefined) continue;
    assertMethodDescriptor(name, descriptor);
    Object.defineProperty(classTarget.prototype, name, {
      ...descriptor,
      enumerable: false,
      configurable: true,
    });
    installed.add(name);
    recorded.push(...recordMethodDescriptor(name, descriptor));
  }
  return recorded;
}

function assertMethodNameAvailable(name: string, taken: ReadonlySet<string>, installed: ReadonlySet<string>): void {
  if (RESERVED_EXTENSION_NAMES.has(name) || taken.has(name) || installed.has(name)) {
    throw new JITError(
      "INVALID_OPERATION",
      `Class extension ${JSON.stringify(name)} would shadow an existing member; rename it`
    );
  }
}

function assertMethodDescriptor(name: string, descriptor: PropertyDescriptor): void {
  if (descriptor.get === undefined && descriptor.set === undefined && typeof descriptor.value !== "function") {
    throw new JITError(
      "INVALID_OPERATION",
      `Class extension ${JSON.stringify(name)} must be a method, a getter or a setter`
    );
  }
}

function recordMethodDescriptor(name: string, descriptor: PropertyDescriptor): InstalledScalarMethod[] {
  const recorded: InstalledScalarMethod[] = [];
  if (descriptor.get !== undefined) recorded.push({ name, kind: "get", source: descriptor.get });
  if (descriptor.set !== undefined) recorded.push({ name, kind: "set", source: descriptor.set });
  if (descriptor.get === undefined && descriptor.set === undefined) {
    recorded.push({ name, kind: "method", source: descriptor.value as Function });
  }
  return recorded;
}

function installScalarDescriptor(
  classTarget: Function,
  name: string,
  definition: ClassMemberDefinition,
  installedMethods: InstalledScalarMethod[]
): void {
  if (definition.kind === "factory") {
    throw new JITError(
      "CLASS_FACTORY_CONFLICT",
      "Factory descriptors belong in .factories(), not an instance extension"
    );
  }
  if (definition.kind === "field") {
    throw new JITError("CLASS_FIELD_DESCRIPTOR_CONFLICT", "Scalar Runtime Types do not expose schema fields");
  }
  if (definition.kind === "method") {
    installScalarMethodDescriptor(classTarget, name, definition, installedMethods);
    return;
  }
  installScalarAccessorDescriptor(classTarget, name, definition, installedMethods);
}

function installScalarMethodDescriptor(
  classTarget: Function,
  name: string,
  definition: Extract<ClassMemberDefinition, { readonly kind: "method" }>,
  installedMethods: InstalledScalarMethod[]
): void {
  if (definition.implementation === undefined) {
    throw new JITError("INVALID_OPERATION", `Class method ${JSON.stringify(name)} must be implemented`);
  }
  installScalarMethod(
    classTarget,
    {
      name,
      kind: "method",
      source: definition.implementation,
      schema: definition.schema as ATS.FunctionSchema,
      ...(definition.async === undefined ? {} : { async: definition.async }),
    },
    installedMethods
  );
}

function installScalarAccessorDescriptor(
  classTarget: Function,
  name: string,
  definition: Extract<ClassMemberDefinition, { readonly kind: "accessor" }>,
  installedMethods: InstalledScalarMethod[]
): void {
  const getter = typeof definition.getter === "function" ? definition.getter : undefined;
  const setter = typeof definition.setter === "function" ? definition.setter : undefined;
  if (getter === undefined && setter === undefined) {
    throw new JITError("CLASS_ACCESSOR_CONFLICT", `Scalar accessor ${JSON.stringify(name)} needs an implementation`);
  }
  const previous = Object.getOwnPropertyDescriptor(classTarget.prototype, name);
  const accessor: PropertyDescriptor = {
    configurable: true,
    enumerable: false,
  };
  const resolvedGetter = getter ?? previous?.get;
  const resolvedSetter = setter ?? previous?.set;
  if (resolvedGetter !== undefined) accessor.get = resolvedGetter as () => unknown;
  if (resolvedSetter !== undefined) accessor.set = resolvedSetter as (value: unknown) => void;
  Object.defineProperty(classTarget.prototype, name, accessor);
  if (getter !== undefined) replaceInstalledScalarMethod(installedMethods, { name, kind: "get", source: getter });
  if (setter !== undefined) replaceInstalledScalarMethod(installedMethods, { name, kind: "set", source: setter });
}

function installScalarMethod(
  classTarget: Function,
  method: ClassMethodDefinition,
  installedMethods: InstalledScalarMethod[]
): void {
  installMethodDefinition(classTarget, method);
  replaceInstalledScalarMethod(installedMethods, {
    name: method.name,
    kind: method.kind,
    source: method.source,
  });
}

function replaceInstalledScalarMethod(installedMethods: InstalledScalarMethod[], method: InstalledScalarMethod): void {
  const index = installedMethods.findIndex((item) => item.name === method.name && item.kind === method.kind);
  if (index === -1) installedMethods.push(method);
  else installedMethods[index] = method;
}
