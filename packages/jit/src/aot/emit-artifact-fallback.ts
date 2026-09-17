import type {
  ArtifactDispatchContext,
  ArtifactEmissionArgs,
  GenericSourceArtifact,
} from "./emit-artifact-dispatch-types.js";
import type { EmittedBinding } from "./emit-artifacts.js";

export function emitDerivedArtifact(context: ArtifactDispatchContext, args: ArtifactEmissionArgs): EmittedBinding {
  const artifact = args.artifact as Extract<ArtifactEmissionArgs["artifact"], { readonly kind: "derived-plan" }>;
  context.js.push(`${args.declaration} /*#__PURE__*/ (() => {`);
  for (const equal of artifact.equalSources)
    context.js.push(`  const ${equal.name} = ${context.asExpression(equal.source, "equal")};`);
  if (artifact.memo) {
    context.js.push(
      `  const memo = ${artifact.source};`,
      `  const __layout = Object.freeze(${JSON.stringify(artifact.layout)});`,
      '  Object.defineProperty(memo, "layout", { value: () => __layout });',
      '  Object.defineProperty(memo, "accepts", { value: (other) => other.id === __layout.id });',
      "  return memo;"
    );
  } else {
    context.js.push(...context.indentBlock(artifact.source), "  return select;");
  }
  context.js.push("})();");
  return { binding: args.binding, type: args.type };
}

export function emitGenericArtifact(
  context: ArtifactDispatchContext,
  args: ArtifactEmissionArgs
): EmittedBinding | undefined {
  const artifact = args.artifact as GenericSourceArtifact;
  const inlined = context.inlineBindings(artifact.bindingNames, artifact.bindingValues);
  if (inlined === undefined) {
    context.skipped.push({
      schema: args.reportName,
      operation: args.artifact.kind,
      reason: `${args.artifact.kind} bindings hold callbacks that cannot be serialized ahead of time`,
    });
    return undefined;
  }
  context.js.push(`${args.declaration} /*#__PURE__*/ (() => {`, ...inlined.map((line) => `  ${line}`));
  context.js.push(`  return (${artifact.source});`, "})();");
  return { binding: args.binding, type: args.type };
}
