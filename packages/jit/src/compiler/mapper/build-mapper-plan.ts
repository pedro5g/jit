import type * as ATS from "../../core/ats/index.js";
import { TypeName } from "../../core/ats/index.js";
import { JITError } from "../../errors/index.js";
import { resolveWrappers } from "../resolvers/resolve-wrappers.js";

type ObjectSchema = ATS.AnyTypeSchema & { readonly def: ATS.ObjectDef };
type ElementSchema = ATS.AnyTypeSchema & { readonly def: ATS.ElementDef };

/** How one target field obtains its value. */
export type MapperFieldSource =
  | { readonly kind: "copy"; readonly from: string; readonly fromOptional: boolean }
  | {
      readonly kind: "copy-object";
      readonly from: string;
      readonly fromOptional: boolean;
      readonly fields: readonly MapperFieldPlan[];
    }
  | {
      readonly kind: "copy-array";
      readonly from: string;
      readonly fromOptional: boolean;
      /** Element field plan for object elements; `undefined` copies elements by assignment. */
      readonly element: readonly MapperFieldPlan[] | undefined;
    }
  | { readonly kind: "via"; readonly from: string; readonly binding: string }
  | { readonly kind: "computed"; readonly binding: string }
  | { readonly kind: "default"; readonly from: string | undefined; readonly binding: string };

export interface MapperFieldPlan {
  readonly key: string;
  readonly source: MapperFieldSource;
}

export interface MapperPlan {
  readonly fields: readonly MapperFieldPlan[];
  readonly bindingNames: readonly string[];
  readonly bindings: readonly unknown[];
}

interface MapperOverrideRecord {
  readonly from?: string;
  readonly via?: (value: unknown, source: unknown) => unknown;
  readonly default?: unknown;
}

export type MapperOverridesInput = Readonly<Record<string, unknown>>;

/**
 * Builds the field plan for a source→target object mapping.
 *
 * Target fields drive the plan: each one is resolved from an explicit
 * override, else auto-matched by name and compatible type (objects and
 * arrays of objects recurse), else omitted when optional. A required target
 * field with no source is a plan error.
 *
 * @throws JITError with code `INVALID_MAPPER` when schemas are not objects,
 * an override is malformed, or a required target field cannot be mapped.
 */
export function buildMapperPlan(
  sourceSchema: ATS.AnyTypeSchema,
  targetSchema: ATS.AnyTypeSchema,
  overrides: MapperOverridesInput = {}
): MapperPlan {
  const source = expectObjectSchema(sourceSchema, "mapper source");
  const target = expectObjectSchema(targetSchema, "mapper target");
  const bindings: unknown[] = [];
  const bindingNames: string[] = [];
  const bind = (value: unknown): string => {
    const name = `__m${bindings.length}`;

    bindings[bindings.length] = value;
    bindingNames[bindingNames.length] = name;
    return name;
  };

  for (const key of Object.keys(overrides)) {
    if (!(key in target.def.props)) {
      throw new JITError("INVALID_MAPPER", `mapper override references unknown target field ${JSON.stringify(key)}`, {
        path: [key],
      });
    }
  }

  const fields = planObjectFields(source, target, overrides, bind, []);

  return { fields, bindingNames, bindings };
}

function planObjectFields(
  source: ObjectSchema,
  target: ObjectSchema,
  overrides: MapperOverridesInput,
  bind: (value: unknown) => string,
  path: readonly string[]
): readonly MapperFieldPlan[] {
  const fields: MapperFieldPlan[] = [];

  for (const key of Object.keys(target.def.props)) {
    const targetProp = target.def.props[key];
    const fieldPath = [...path, key];
    const override = overrides[key] as MapperOverrideRecord | ((source: unknown) => unknown) | undefined;

    if (override !== undefined) {
      fields[fields.length] = { key, source: planOverride(source, key, override, bind, fieldPath) };
      continue;
    }

    const planned = planAutoMatch(source, key, targetProp, bind, fieldPath);

    if (planned) fields[fields.length] = { key, source: planned };
  }

  return fields;
}

function planOverride(
  source: ObjectSchema,
  key: string,
  override: MapperOverrideRecord | ((source: unknown) => unknown),
  bind: (value: unknown) => string,
  path: readonly string[]
): MapperFieldSource {
  if (typeof override === "function") {
    return { kind: "computed", binding: bind(override) };
  }

  if (typeof override !== "object" || override === null) {
    throw new JITError("INVALID_MAPPER", `mapper override for ${JSON.stringify(key)} must be a function or object`, {
      path,
    });
  }

  if (override.via !== undefined) {
    if (typeof override.from !== "string") {
      throw new JITError("INVALID_MAPPER", `mapper override for ${JSON.stringify(key)} with via requires from`, {
        path,
      });
    }

    expectSourceField(source, override.from, path);
    return { kind: "via", from: override.from, binding: bind(override.via) };
  }

  if (override.from !== undefined) {
    expectSourceField(source, override.from, path);
    const planned = planAutoMatch(source, override.from, undefined, bind, path);

    if (!planned) {
      throw new JITError(
        "INVALID_MAPPER",
        `mapper cannot copy source field ${JSON.stringify(override.from)}; use via to convert it`,
        { path }
      );
    }

    return planned;
  }

  if ("default" in override) {
    const from = key in source.def.props ? key : undefined;

    return { kind: "default", from, binding: bind(override.default) };
  }

  throw new JITError("INVALID_MAPPER", `mapper override for ${JSON.stringify(key)} must define from, via, or default`, {
    path,
  });
}

/**
 * Auto-matches `source.def.props[from]` against `targetProp` (same-name copy
 * or rename copy). Passing `targetProp === undefined` skips the target-side
 * compatibility check (used by `{ from }` renames, where TypeScript already
 * enforced value compatibility).
 */
function planAutoMatch(
  source: ObjectSchema,
  from: string,
  targetProp: ATS.AnyTypeSchema | undefined,
  bind: (value: unknown) => string,
  path: readonly string[]
): MapperFieldSource | undefined {
  const sourceProp = source.def.props[from];

  if (sourceProp === undefined) {
    if (targetProp !== undefined && resolveWrappers(targetProp).optional) return undefined;

    throw new JITError(
      "INVALID_MAPPER",
      `mapper target field ${JSON.stringify(path[path.length - 1])} has no source match and no override`,
      { path }
    );
  }

  const sourceResolved = resolveWrappers(sourceProp);
  const targetResolved = targetProp === undefined ? undefined : resolveWrappers(targetProp);

  if (targetResolved && sourceResolved.optional && !targetResolved.optional) {
    throw new JITError(
      "INVALID_MAPPER",
      `mapper source field ${JSON.stringify(from)} is optional but the target field is required; use default or via`,
      { path }
    );
  }

  const sourceBase = sourceResolved.base;
  const targetBase = targetResolved?.base;

  if (sourceBase.type === TypeName.object && (targetBase === undefined || targetBase.type === TypeName.object)) {
    const nestedTarget = (targetBase ?? sourceBase) as ObjectSchema;
    const fields = planObjectFields(sourceBase as ObjectSchema, nestedTarget, {}, bind, path);

    return { kind: "copy-object", from, fromOptional: sourceResolved.optional, fields };
  }

  if (sourceBase.type === TypeName.array && (targetBase === undefined || targetBase.type === TypeName.array)) {
    const sourceElement = resolveWrappers((sourceBase as ElementSchema).def.element).base;
    const targetElement =
      targetBase === undefined ? sourceElement : resolveWrappers((targetBase as ElementSchema).def.element).base;

    if (sourceElement.type === TypeName.object && targetElement.type === TypeName.object) {
      const element = planObjectFields(sourceElement as ObjectSchema, targetElement as ObjectSchema, {}, bind, path);

      return { kind: "copy-array", from, fromOptional: sourceResolved.optional, element };
    }

    if (isCompatibleBase(sourceElement.type, targetElement.type)) {
      return { kind: "copy-array", from, fromOptional: sourceResolved.optional, element: undefined };
    }

    if (targetResolved?.optional) return undefined;

    throw new JITError("INVALID_MAPPER", `mapper array field ${JSON.stringify(from)} has incompatible element types`, {
      path,
    });
  }

  if (targetBase === undefined || isCompatibleBase(sourceBase.type, targetBase.type)) {
    return { kind: "copy", from, fromOptional: sourceResolved.optional };
  }

  if (targetResolved?.optional) return undefined;

  throw new JITError(
    "INVALID_MAPPER",
    `mapper field ${JSON.stringify(from)} has type ${sourceBase.type} but the target expects ${targetBase.type}`,
    { path }
  );
}

function isCompatibleBase(source: ATS.AnyTypeName, target: ATS.AnyTypeName): boolean {
  if (source === target) return true;
  if (source === TypeName.int && target === TypeName.number) return true;

  return false;
}

function expectSourceField(source: ObjectSchema, from: string, path: readonly string[]): void {
  if (!(from in source.def.props)) {
    throw new JITError("INVALID_MAPPER", `mapper override references unknown source field ${JSON.stringify(from)}`, {
      path,
    });
  }
}

function expectObjectSchema(schema: ATS.AnyTypeSchema, label: string): ObjectSchema {
  const resolved = resolveWrappers(schema).base;

  if (resolved.type !== TypeName.object) {
    throw new JITError("INVALID_MAPPER", `${label} must be an object schema`);
  }

  return resolved as ObjectSchema;
}
