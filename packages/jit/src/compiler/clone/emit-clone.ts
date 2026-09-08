import { JITError } from "../../errors/index.js";
import { emitDefaultedValue } from "../defaults.js";
import { CodeWriter } from "../emitter/code-writer.js";
import { createEmitState, type EmitState } from "../emitter/emit-state.js";
import { emitGuardTest } from "../schema-nodes.js";
import { emitPropertyAccess } from "../source/access.js";
import { emitSchemaGuard, literalDiscriminatorValue } from "../source/guard.js";
import { emitLiteral, emitObjectKey } from "../source/literal.js";
import type { CloneIRNode, CloneIRProgram } from "./build-clone-ir.js";

export interface CloneBindings {
  readonly names: string[];
  readonly values: unknown[];
}

interface CloneEmitContext {
  readonly bindings: CloneBindings;
  readonly allowRuntimeTypeBindings: boolean;
  readonly useTrustedRuntimeTypeMaterializers: boolean;
  readonly ids: Map<Function, string>;
}

export function emitClone(program: CloneIRProgram): string {
  const writer = new CodeWriter();
  const context = createContext(false, true);

  emitHelpers(writer, program, context);
  writer.line(`function clone(${program.param}) {`);
  writer.indent(() => {
    emitCloneReturn(writer, program.body, program.param, context);
  });
  writer.line("}");

  return writer.toString();
}

export function emitCloneBody(program: CloneIRProgram): string {
  return emitCloneBodyWithBindings(program).source;
}

export function emitCloneBodyWithBindings(
  program: CloneIRProgram,
  options: {
    readonly allowRuntimeTypeBindings?: boolean;
    readonly useTrustedRuntimeTypeMaterializers?: boolean;
  } = {}
): { readonly source: string; readonly bindings: CloneBindings } {
  const writer = new CodeWriter();
  const context = createContext(
    options.allowRuntimeTypeBindings ?? true,
    options.useTrustedRuntimeTypeMaterializers ?? true
  );

  emitHelpers(writer, program, context);
  emitCloneReturn(writer, program.body, program.param, context);

  return { source: writer.toString(), bindings: context.bindings };
}

/**
 * One named function per cycle participant. A recursive node then compiles to
 * a call, so a self-referencing schema produces finite source that recurses at
 * run time instead of at emit time.
 */
function createContext(
  allowRuntimeTypeBindings: boolean,
  useTrustedRuntimeTypeMaterializers: boolean
): CloneEmitContext {
  return {
    bindings: { names: [], values: [] },
    allowRuntimeTypeBindings,
    useTrustedRuntimeTypeMaterializers,
    ids: new Map(),
  };
}

function emitHelpers(writer: CodeWriter, program: CloneIRProgram, context: CloneEmitContext): void {
  for (const helper of program.helpers) {
    writer.line(`function ${helperName(helper.id)}(${program.param}) {`);
    writer.indent(() => {
      emitCloneReturn(writer, helper.node, program.param, context);
    });
    writer.line("}");
  }
}

function emitCloneReturn(writer: CodeWriter, node: CloneIRNode, source: string, context: CloneEmitContext): void {
  const inline = emitInlineClone(node, source, context);

  if (inline) {
    writer.line(`return ${inline};`);
    return;
  }

  emitCloneTo(writer, createEmitState(), node, source, "out", context);
  writer.line("return out;");
}

function helperName(id: string): string {
  return `clone_${id}`;
}

function emitCloneTo(
  writer: CodeWriter,
  state: EmitState,
  node: CloneIRNode,
  source: string,
  target: string,
  context: CloneEmitContext
): void {
  const inline = emitInlineClone(node, source, context);

  if (inline) {
    writer.line(`const ${target} = ${inline};`);
    return;
  }

  switch (node.kind) {
    case "array":
      emitArrayClone(writer, state, node, source, target, context);
      return;
    case "tuple":
      emitTupleClone(writer, state, node, source, target, context);
      return;
    case "record":
      emitRecordClone(writer, state, node, source, target, context);
      return;
    case "set":
      emitSetClone(writer, state, node, source, target, context);
      return;
    case "map":
      emitMapClone(writer, state, node, source, target, context);
      return;
    case "runtimeType":
      emitRuntimeTypeClone(writer, state, node, source, target, context);
      return;
    case "guard":
      emitGuardClone(writer, state, node, source, target, context);
      return;
    case "union":
      emitUnionClone(writer, state, node, source, target, context);
      return;
    case "intersection":
      emitIntersectionClone(writer, state, node, source, target, context);
      return;
    case "discriminatedUnion":
      emitDiscriminatedUnionClone(writer, state, node, source, target, context);
      return;
    case "object":
      emitObjectClone(writer, state, node, source, target, context);
      return;
    case "date":
    case "reuse":
    case "recursive":
      return;
  }
}

function emitInlineClone(node: CloneIRNode, source: string, context: CloneEmitContext): string | undefined {
  switch (node.kind) {
    case "reuse":
      return source;
    case "recursive":
      return `${helperName(node.id)}(${source})`;
    case "date":
      return `new Date(${source}.getTime())`;
    case "object":
      return emitInlineObjectClone(node, source, context);
    case "tuple":
      return emitInlineTupleClone(node, source, context);
    case "runtimeType":
      return node.immutable ? source : undefined;
    case "array":
    case "record":
    case "set":
    case "map":
    case "guard":
    case "union":
    case "intersection":
    case "discriminatedUnion":
      return undefined;
  }
}

function emitInlineObjectClone(
  node: Extract<CloneIRNode, { readonly kind: "object" }>,
  source: string,
  context: CloneEmitContext
): string | undefined {
  const props: string[] = [];

  for (const prop of node.props) {
    const propSource = emitDefaultedValue(prop.schema, emitPropertyAccess(source, prop.key));
    const cloned = emitInlineClone(prop.value, propSource, context);

    if (!cloned) {
      return undefined;
    }

    props.push(`${emitObjectKey(prop.key)}: ${cloned}`);
  }

  return `{ ${props.join(", ")} }`;
}

function emitInlineTupleClone(
  node: Extract<CloneIRNode, { readonly kind: "tuple" }>,
  source: string,
  context: CloneEmitContext
): string | undefined {
  const items: string[] = [];

  for (let index = 0; index < node.items.length; index++) {
    const cloned = emitInlineClone(node.items[index], `${source}[${index}]`, context);

    if (!cloned) {
      return undefined;
    }

    items.push(cloned);
  }

  return `[${items.join(", ")}]`;
}

function emitObjectClone(
  writer: CodeWriter,
  state: EmitState,
  node: Extract<CloneIRNode, { readonly kind: "object" }>,
  source: string,
  target: string,
  context: CloneEmitContext
): void {
  const entries: string[] = [];

  for (const prop of node.props) {
    const propSource = emitDefaultedValue(prop.schema, emitPropertyAccess(source, prop.key));
    const inline = emitInlineClone(prop.value, propSource, context);

    if (inline) {
      entries.push(`${emitObjectKey(prop.key)}: ${inline}`);
      continue;
    }

    const propTarget = state.nextVar(`${target}_${prop.key}`);
    emitCloneTo(writer, state, prop.value, propSource, propTarget, context);
    entries.push(`${emitLiteral(prop.key)}: ${propTarget}`);
  }

  writer.line(`const ${target} = { ${entries.join(", ")} };`);
}

function emitTupleClone(
  writer: CodeWriter,
  state: EmitState,
  node: Extract<CloneIRNode, { readonly kind: "tuple" }>,
  source: string,
  target: string,
  context: CloneEmitContext
): void {
  const entries: string[] = [];

  for (let index = 0; index < node.items.length; index++) {
    const itemSource = `${source}[${index}]`;
    const inline = emitInlineClone(node.items[index], itemSource, context);

    if (inline) {
      entries.push(inline);
      continue;
    }

    const itemTarget = state.nextVar(`${target}_${index}`);
    emitCloneTo(writer, state, node.items[index], itemSource, itemTarget, context);
    entries.push(itemTarget);
  }

  writer.line(`const ${target} = [${entries.join(", ")}];`);
}

function emitArrayClone(
  writer: CodeWriter,
  state: EmitState,
  node: Extract<CloneIRNode, { readonly kind: "array" }>,
  source: string,
  target: string,
  context: CloneEmitContext
): void {
  const len = state.nextVar("len");
  const index = state.nextVar("i");
  const item = state.nextVar("item");

  writer.line(`const ${len} = ${source}.length;`);
  writer.line(`const ${target} = new Array(${len});`);
  writer.line(`for (let ${index} = 0; ${index} < ${len}; ${index}++) {`);
  writer.indent(() => {
    const itemSource = `${source}[${index}]`;
    const inline = emitInlineClone(node.element, itemSource, context);

    if (inline) {
      writer.line(`${target}[${index}] = ${inline};`);
      return;
    }

    emitCloneTo(writer, state, node.element, itemSource, item, context);
    writer.line(`${target}[${index}] = ${item};`);
  });
  writer.line("}");
}

function emitRecordClone(
  writer: CodeWriter,
  state: EmitState,
  node: Extract<CloneIRNode, { readonly kind: "record" }>,
  source: string,
  target: string,
  context: CloneEmitContext
): void {
  const keys = state.nextVar("keys");
  const len = state.nextVar("len");
  const index = state.nextVar("i");
  const key = state.nextVar("key");
  const clonedValue = state.nextVar("clonedValue");

  writer.line(`const ${keys} = Object.keys(${source});`);
  writer.line(`const ${target} = {};`);
  writer.line(`for (let ${index} = 0, ${len} = ${keys}.length; ${index} < ${len}; ${index}++) {`);
  writer.indent(() => {
    writer.line(`const ${key} = ${keys}[${index}];`);
    emitCloneTo(writer, state, node.value, `${source}[${key}]`, clonedValue, context);
    writer.line(`${target}[${key}] = ${clonedValue};`);
  });
  writer.line("}");
}

function emitSetClone(
  writer: CodeWriter,
  state: EmitState,
  node: Extract<CloneIRNode, { readonly kind: "set" }>,
  source: string,
  target: string,
  context: CloneEmitContext
): void {
  const item = state.nextVar("item");
  const clonedValue = state.nextVar("clonedValue");

  writer.line(`const ${target} = new Set();`);
  writer.line(`for (const ${item} of ${source}) {`);
  writer.indent(() => {
    emitCloneTo(writer, state, node.element, item, clonedValue, context);
    writer.line(`${target}.add(${clonedValue});`);
  });
  writer.line("}");
}

function emitMapClone(
  writer: CodeWriter,
  state: EmitState,
  node: Extract<CloneIRNode, { readonly kind: "map" }>,
  source: string,
  target: string,
  context: CloneEmitContext
): void {
  const entry = state.nextVar("entry");
  const key = state.nextVar("key");
  const mapValue = state.nextVar("mapValue");
  const nextKey = state.nextVar("nextKey");
  const nextValue = state.nextVar("nextValue");

  writer.line(`const ${target} = new Map();`);
  writer.line(`for (const ${entry} of ${source}) {`);
  writer.indent(() => {
    writer.line(`const ${key} = ${entry}[0];`);
    writer.line(`const ${mapValue} = ${entry}[1];`);
    emitCloneTo(writer, state, node.key, key, nextKey, context);
    emitCloneTo(writer, state, node.value, mapValue, nextValue, context);
    writer.line(`${target}.set(${nextKey}, ${nextValue});`);
  });
  writer.line("}");
}

function emitRuntimeTypeClone(
  writer: CodeWriter,
  state: EmitState,
  node: Extract<CloneIRNode, { readonly kind: "runtimeType" }>,
  source: string,
  target: string,
  context: CloneEmitContext
): void {
  if (!context.allowRuntimeTypeBindings) {
    throw new JITError(
      "UNSUPPORTED_SCHEMA",
      "AOT cannot reconstruct a clone for a Runtime Type without a declarative materializer"
    );
  }

  const innerTarget = state.nextVar(`${target}_inner`);
  const innerSource = node.representation === "value" ? emitPropertyAccess(source, "value") : source;

  emitCloneTo(writer, state, node.inner, innerSource, innerTarget, context);

  const materializer =
    context.useTrustedRuntimeTypeMaterializers && node.trustedMaterializer !== undefined
      ? node.trustedMaterializer
      : node.materializer;
  const binding = bindCloneValue(context, materializer);

  if (context.useTrustedRuntimeTypeMaterializers && node.trustedMaterializer !== undefined) {
    writer.line(`const ${target} = ${binding}(${innerTarget});`);
  } else {
    writer.line(`const ${target} = new ${binding}(${innerTarget}, true);`);
  }
}

function bindCloneValue(context: CloneEmitContext, value: Function): string {
  const existing = context.ids.get(value);

  if (existing !== undefined) return existing;

  const name = `__m${context.bindings.names.length}`;
  context.ids.set(value, name);
  context.bindings.names.push(name);
  context.bindings.values.push(value);
  return name;
}

function emitGuardClone(
  writer: CodeWriter,
  state: EmitState,
  node: Extract<CloneIRNode, { readonly kind: "guard" }>,
  source: string,
  target: string,
  context: CloneEmitContext
): void {
  writer.line(`let ${target} = ${source};`);
  writer.line(`if (${emitGuardTest(node.optional, node.nullable, source)}) {`);
  writer.indent(() => {
    const inner = state.nextVar(`${target}_inner`);
    emitCloneTo(writer, state, node.inner, source, inner, context);
    writer.line(`${target} = ${inner};`);
  });
  writer.line("}");
}

function emitUnionClone(
  writer: CodeWriter,
  state: EmitState,
  node: Extract<CloneIRNode, { readonly kind: "union" }>,
  source: string,
  target: string,
  context: CloneEmitContext
): void {
  writer.line(`let ${target};`);

  for (let index = 0; index < node.options.length; index++) {
    const option = node.options[index];
    const keyword = index === 0 ? "if" : "else if";

    writer.line(`${keyword} (${emitSchemaGuard(option.schema, source)}) {`);
    writer.indent(() => {
      const optionTarget = state.nextVar(`${target}_${index}`);
      emitCloneTo(writer, state, option.node, source, optionTarget, context);
      writer.line(`${target} = ${optionTarget};`);
    });
    writer.line("}");
  }
}

function emitIntersectionClone(
  writer: CodeWriter,
  state: EmitState,
  node: Extract<CloneIRNode, { readonly kind: "intersection" }>,
  source: string,
  target: string,
  context: CloneEmitContext
): void {
  const parts: string[] = [];

  for (let index = 0; index < node.options.length; index++) {
    const optionTarget = state.nextVar(`${target}_${index}`);
    emitCloneTo(writer, state, node.options[index], source, optionTarget, context);
    parts.push(optionTarget);
  }

  writer.line(`const ${target} = Object.assign({}, ${parts.join(", ")});`);
}

function emitDiscriminatedUnionClone(
  writer: CodeWriter,
  state: EmitState,
  node: Extract<CloneIRNode, { readonly kind: "discriminatedUnion" }>,
  source: string,
  target: string,
  context: CloneEmitContext
): void {
  const tag = emitPropertyAccess(source, node.discriminator);

  writer.line(`let ${target};`);

  for (let index = 0; index < node.options.length; index++) {
    const option = node.options[index];
    const value = literalDiscriminatorValue(option.schema, node.discriminator);

    if (value === undefined) continue;

    const keyword = index === 0 ? "if" : "else if";

    writer.line(`${keyword} (${tag} === ${emitLiteral(value)}) {`);
    writer.indent(() => {
      const optionTarget = state.nextVar(`${target}_${index}`);
      emitCloneTo(writer, state, option.node, source, optionTarget, context);
      writer.line(`${target} = ${optionTarget};`);
    });
    writer.line("}");
  }
}
