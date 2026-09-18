import { resolveWrappers } from "../compiler/resolvers/resolve-wrappers.js";
import { canUseFastParse } from "../compiler/validate/emit-validate-support.js";
import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import type { ClassArtifact, ClassArtifactEmitContext } from "./emit-class-types.js";

export interface ClassArtifactSetup {
  readonly artifact: ClassArtifact;
  readonly base: ATS.ObjectSchema | undefined;
  readonly valueRepresentation: boolean;
  readonly hasDomainState: boolean;
  readonly creationSchema: ATS.AnyTypeSchema;
  readonly hydrateSchema: ATS.AnyTypeSchema;
  readonly fastPolicyCreate: boolean;
  readonly fastPolicyHydrate: boolean;
  readonly unvalidatedDdd: boolean;
  readonly materializerNeedsIssues: boolean;
  readonly validationBinding: string;
  readonly hydrateBinding: string;
  readonly materializer: string | undefined;
  readonly hydrateMaterializer: string | undefined;
}

interface ClassValidationSetup {
  readonly validationBinding: string;
  readonly hydrateBinding: string;
  readonly materializer: string | undefined;
  readonly hydrateMaterializer: string | undefined;
  readonly materializerNeedsIssues: boolean;
}

export function prepareClassArtifact(
  context: ClassArtifactEmitContext,
  binding: string,
  artifact: ClassArtifact,
  reportName: string
): ClassArtifactSetup | undefined {
  const base = resolveObjectSchema(artifact.schema);
  const valueRepresentation = artifact.representation === "value";
  if (!valueRepresentation && base === undefined) {
    skipClass(context, reportName, "class", "JIT classes require an object schema");
    return undefined;
  }
  if (hasUnsupportedClassFeatures(context, artifact, reportName)) return undefined;
  const creationSchema = artifact.domainEvent
    ? (base as ATS.ObjectSchema).def.props.payload
    : (artifact.creationSchema ?? artifact.schema);
  const hydrateSchema = artifact.hydrateSchema ?? artifact.schema;
  const fastPolicyCreate = artifact.policy?.maxIssues === undefined && canUseFastParse(creationSchema);
  const fastPolicyHydrate = artifact.policy?.maxIssues === undefined && canUseFastParse(hydrateSchema);
  const unvalidatedDdd = isUnvalidatedDdd(artifact);
  const validation = emitClassValidation(
    context,
    binding,
    artifact,
    reportName,
    creationSchema,
    hydrateSchema,
    fastPolicyCreate,
    fastPolicyHydrate,
    unvalidatedDdd
  );
  if (validation === undefined) return undefined;
  if (!unvalidatedDdd || validation.materializerNeedsIssues) context.mark("validationError");
  return {
    artifact,
    base,
    valueRepresentation,
    hasDomainState: artifact.encapsulateFields === true || artifact.domainStateLayout?.storage === "symbol",
    creationSchema,
    hydrateSchema,
    fastPolicyCreate,
    fastPolicyHydrate,
    unvalidatedDdd,
    ...validation,
  };
}

function resolveObjectSchema(schema: ATS.AnyTypeSchema): ATS.ObjectSchema | undefined {
  const base = resolveWrappers(schema).base;
  return base.type === TypeName.object ? (base as ATS.ObjectSchema) : undefined;
}

function hasUnsupportedClassFeatures(
  context: ClassArtifactEmitContext,
  artifact: ClassArtifact,
  reportName: string
): boolean {
  const applicationMethods = artifact.methods ?? [];
  if (applicationMethods.length > 0)
    return skipClass(
      context,
      reportName,
      "class.extends",
      `application extension ${JSON.stringify(applicationMethods[0]?.name)} is a runtime binding and has no reconstructive AOT representation`
    );
  if (artifact.customFactories?.create !== undefined || artifact.customFactories?.hydrate !== undefined)
    return skipClass(
      context,
      reportName,
      "class.factories",
      "a custom factory is a runtime binding and has no standalone AOT representation"
    );
  if (artifact.mutation?.timestampClock !== undefined || artifact.mutation?.deletionClock !== undefined)
    return skipClass(
      context,
      reportName,
      "class.extends",
      "a custom DDD clock is a runtime binding and has no standalone AOT representation"
    );
  if (artifact.policy?.nestedErrors?.some((candidate) => candidate.runtimeBinding === true) === true)
    return skipClass(
      context,
      reportName,
      "class.validate",
      "a nested custom error factory is a runtime binding and has no standalone AOT representation"
    );
  return false;
}

function emitClassValidation(
  context: ClassArtifactEmitContext,
  binding: string,
  artifact: ClassArtifact,
  reportName: string,
  creationSchema: ATS.AnyTypeSchema,
  hydrateSchema: ATS.AnyTypeSchema,
  fastPolicyCreate: boolean,
  fastPolicyHydrate: boolean,
  unvalidatedDdd: boolean
): ClassValidationSetup | undefined {
  const materializerNeedsIssues =
    context.hasNestedValidation(creationSchema) || context.hasNestedValidation(hydrateSchema);
  const validator = unvalidatedDdd
    ? undefined
    : context.emitValidatorBinding(binding, creationSchema, reportName, "class", {
        is: fastPolicyCreate,
        safeParse: true,
        ...(artifact.policy?.maxIssues === undefined ? {} : { maxIssues: artifact.policy.maxIssues }),
      });
  const hydrateValidator = emitHydrateValidator(
    context,
    binding,
    artifact,
    reportName,
    hydrateSchema,
    fastPolicyHydrate,
    unvalidatedDdd,
    validator
  );
  if (!unvalidatedDdd && (validator === undefined || hydrateValidator === undefined)) return undefined;
  const materializer = emitUnvalidatedMaterializer(
    context,
    binding,
    artifact,
    reportName,
    creationSchema,
    materializerNeedsIssues,
    unvalidatedDdd
  );
  const hydrateMaterializer = emitUnvalidatedHydrateMaterializer(
    context,
    binding,
    artifact,
    reportName,
    hydrateSchema,
    materializerNeedsIssues,
    unvalidatedDdd
  );
  if (unvalidatedDdd && (materializer === undefined || hydrateMaterializer === undefined)) return undefined;
  return {
    validationBinding: (validator ?? materializer) as string,
    hydrateBinding: (hydrateValidator ?? hydrateMaterializer) as string,
    materializer,
    hydrateMaterializer,
    materializerNeedsIssues,
  };
}

function emitHydrateValidator(
  context: ClassArtifactEmitContext,
  binding: string,
  artifact: ClassArtifact,
  reportName: string,
  hydrateSchema: ATS.AnyTypeSchema,
  fastPolicyHydrate: boolean,
  unvalidatedDdd: boolean,
  validator: string | undefined
): string | undefined {
  if (unvalidatedDdd) return undefined;
  if (artifact.domainEvent) return validator;
  return context.emitValidatorBinding(binding, hydrateSchema, reportName, "class.hydrate", {
    is: fastPolicyHydrate,
    safeParse: true,
    resolveDefaults: false,
    ...(artifact.policy?.maxIssues === undefined ? {} : { maxIssues: artifact.policy.maxIssues }),
  });
}

function emitUnvalidatedMaterializer(
  context: ClassArtifactEmitContext,
  binding: string,
  artifact: ClassArtifact,
  reportName: string,
  creationSchema: ATS.AnyTypeSchema,
  materializerNeedsIssues: boolean,
  unvalidatedDdd: boolean
): string | undefined {
  if (!unvalidatedDdd) return undefined;
  return context.emitValidatorBinding(binding, creationSchema, reportName, "class.materialize", {
    is: false,
    safeParse: artifact.policy !== undefined || materializerNeedsIssues,
    parse: artifact.policy === undefined && !materializerNeedsIssues,
    validateChecks: false,
  });
}

function emitUnvalidatedHydrateMaterializer(
  context: ClassArtifactEmitContext,
  binding: string,
  artifact: ClassArtifact,
  reportName: string,
  hydrateSchema: ATS.AnyTypeSchema,
  materializerNeedsIssues: boolean,
  unvalidatedDdd: boolean
): string | undefined {
  if (!unvalidatedDdd) return undefined;
  return context.emitValidatorBinding(binding, hydrateSchema, reportName, "class.materializeHydrate", {
    is: false,
    safeParse: artifact.policy !== undefined || materializerNeedsIssues,
    parse: artifact.policy === undefined && !materializerNeedsIssues,
    resolveDefaults: false,
    validateChecks: false,
  });
}

function isUnvalidatedDdd(artifact: ClassArtifact): boolean {
  return (
    artifact.domainEvent === undefined &&
    artifact.factoryValidationOptIn === true &&
    artifact.policy?.validationConfigured !== true
  );
}

function skipClass(context: ClassArtifactEmitContext, schema: string, operation: string, reason: string): true {
  context.skipped.push({ schema, operation, reason });
  return true;
}
