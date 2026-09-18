import { classGetter, classPrivate, classProtected, classPublic, classSetter } from "../classes/member-descriptors.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import type {
  ClassCapability,
  ClassExtensionBuilder,
  ClassMemberDescriptor,
  ClassMemberVisibility,
  ClassMethodsInput,
  ClassMixin,
} from "./class.js";

export const CLASS_MIXIN = Symbol("jit.class.mixin");
const CLASS_FIELD_BUILDER = Symbol("jit.class.fieldBuilder");

/** Members reserved by scalar Value Objects before application extensions run. */
export const SCALAR_MEMBERS: ReadonlySet<string> = new Set(["value", "equals", "hashCode", "toJSON"]);

/** Names that cannot be shadowed by a Runtime Class extension. */
export const RESERVED_EXTENSION_NAMES: ReadonlySet<string> = new Set([
  "constructor",
  "schema",
  "create",
  "hydrate",
  "extends",
  "factories",
  "construction",
  "accessors",
  "validate",
  "assert",
]);

export function isClassMixin(value: unknown): value is ClassMixin {
  return typeof value === "function" && (value as { readonly [CLASS_MIXIN]?: unknown })[CLASS_MIXIN] === true;
}

export function isClassCapability(value: unknown): value is ClassCapability {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { install?: unknown }).install === "function" &&
    typeof (value as { kind?: unknown }).kind === "string"
  );
}

type ClassExtensionFactory = (builder: ClassExtensionBuilder<ATS.AnyTypeSchema, unknown, boolean>) => ClassMethodsInput;

export function isClassExtensionFactory(value: unknown): value is ClassExtensionFactory {
  return typeof value === "function" && !isClassCapability(value) && !isClassMixin(value);
}

interface RuntimeClassExtensionFieldBuilder {
  readonly [CLASS_FIELD_BUILDER]: true;
  readonly name: string | undefined;
  readonly schema: SchemaInput<ATS.AnyTypeSchema>;
  readonly visibility: ClassMemberVisibility;
  readonly customGetter?: Function;
  readonly customSetter?: Function;
  public(): RuntimeClassExtensionFieldBuilder;
  protected(): RuntimeClassExtensionFieldBuilder;
  private(): RuntimeClassExtensionFieldBuilder;
  getter(implementation: Function): RuntimeClassExtensionFieldBuilder;
  setter(implementation: Function): RuntimeClassExtensionFieldBuilder;
  toDescriptor(name: string): ClassMemberDescriptor;
}

function createClassExtensionFieldBuilder(
  name: string | undefined,
  schema: SchemaInput<ATS.AnyTypeSchema>,
  visibility: ClassMemberVisibility = "public",
  customGetter?: Function,
  customSetter?: Function
): RuntimeClassExtensionFieldBuilder {
  const builder: RuntimeClassExtensionFieldBuilder = {
    [CLASS_FIELD_BUILDER]: true,
    name,
    schema,
    visibility,
    ...(customGetter === undefined ? {} : { customGetter }),
    ...(customSetter === undefined ? {} : { customSetter }),
    public: () => createClassExtensionFieldBuilder(name, schema, "public", customGetter, customSetter),
    protected: () => createClassExtensionFieldBuilder(name, schema, "protected", customGetter, customSetter),
    private: () => createClassExtensionFieldBuilder(name, schema, "private", customGetter, customSetter),
    getter: (implementation: Function) =>
      createClassExtensionFieldBuilder(name, schema, visibility, implementation, customSetter),
    setter: (implementation: Function) =>
      createClassExtensionFieldBuilder(name, schema, visibility, customGetter, implementation),
    toDescriptor: (propertyName: string) => {
      if (name !== undefined && propertyName !== name) {
        throw new JITError(
          "CLASS_FIELD_DESCRIPTOR_CONFLICT",
          `Class extension field ${JSON.stringify(name)} was assigned to ${JSON.stringify(propertyName)}`
        );
      }
      const accessors = [
        ...(customGetter === undefined ? [] : [classGetter(customGetter)]),
        ...(customSetter === undefined ? [] : [classSetter(customSetter)]),
      ];
      if (visibility === "protected") return classProtected(schema, ...accessors);
      if (visibility === "private") return classPrivate(schema, ...accessors);
      return classPublic(schema, ...accessors);
    },
  };
  return Object.freeze(builder);
}

export function isClassExtensionFieldBuilder(value: unknown): value is RuntimeClassExtensionFieldBuilder {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly [CLASS_FIELD_BUILDER]?: unknown })[CLASS_FIELD_BUILDER] === true
  );
}

export function createClassExtensionBuilder(): ClassExtensionBuilder<ATS.AnyTypeSchema, unknown, boolean> {
  return Object.freeze({
    field(nameOrSchema: string | SchemaInput<ATS.AnyTypeSchema>, schema?: SchemaInput<ATS.AnyTypeSchema>) {
      return schema === undefined
        ? createClassExtensionFieldBuilder(undefined, nameOrSchema as SchemaInput<ATS.AnyTypeSchema>)
        : createClassExtensionFieldBuilder(nameOrSchema as string, schema);
    },
  }) as unknown as ClassExtensionBuilder<ATS.AnyTypeSchema, unknown, boolean>;
}
