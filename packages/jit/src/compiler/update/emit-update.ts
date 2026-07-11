import { emitDefaultedValue } from "../defaults.js";
import { CodeWriter } from "../emitter/code-writer.js";
import { createEmitState, type EmitState } from "../emitter/emit-state.js";
import { emitGuardTest } from "../schema-nodes.js";
import { emitPropertyAccess } from "../source/access.js";
import { emitSchemaGuard, literalDiscriminatorValue } from "../source/guard.js";
import { emitLiteral } from "../source/literal.js";
import type { UpdateIRNode, UpdateIRProgram } from "./build-update-ir.js";

export function emitUpdate(program: UpdateIRProgram): string {
  const writer = new CodeWriter();

  writer.line(`function update(${program.valueParam}, ${program.patchParam}) {`);
  writer.indent(() => {
    emitUpdateBodyLines(writer, createEmitState(), program.body, program.valueParam, program.patchParam);
  });
  writer.line("}");

  return writer.toString();
}

export function emitUpdateBody(program: UpdateIRProgram): string {
  const writer = new CodeWriter();

  emitUpdateBodyLines(writer, createEmitState(), program.body, program.valueParam, program.patchParam);

  return writer.toString();
}

function emitUpdateBodyLines(
  writer: CodeWriter,
  state: EmitState,
  node: UpdateIRNode,
  value: string,
  patch: string
): void {
  emitUpdateTo(writer, state, node, value, patch, "out");
  writer.line("return out;");
}

function emitUpdateTo(
  writer: CodeWriter,
  state: EmitState,
  node: UpdateIRNode,
  value: string,
  patch: string,
  target: string
): void {
  switch (node.kind) {
    case "reuse":
      writer.line(`let ${target} = ${value};`);
      writer.line(`if (${patch} !== undefined && !Object.is(${value}, ${patch})) {`);
      writer.indent(() => writer.line(`${target} = ${patch};`));
      writer.line("}");
      return;
    case "date":
      writer.line(`let ${target} = ${value};`);
      writer.line(
        `if (${patch} !== undefined && !Object.is(${value}, ${patch}) && ${value}.getTime() !== ${patch}.getTime()) {`
      );
      writer.indent(() => writer.line(`${target} = new Date(${patch}.getTime());`));
      writer.line("}");
      return;
    case "union":
      emitUnionUpdateTo(writer, state, node, value, patch, target);
      return;
    case "discriminatedUnion":
      emitDiscriminatedUnionUpdateTo(writer, state, node, value, patch, target);
      return;
    case "guard":
      emitGuardUpdateTo(writer, state, node, value, patch, target);
      return;
    case "object":
      emitObjectUpdateTo(writer, state, node, value, patch, target);
      return;
    case "array":
      emitArrayUpdateTo(writer, state, node, value, patch, target);
      return;
    case "tuple":
      emitTupleUpdateTo(writer, state, node, value, patch, target);
      return;
    case "record":
      emitRecordUpdateTo(writer, state, node, value, patch, target);
      return;
    case "set":
      emitSetUpdateTo(writer, value, patch, target);
      return;
    case "map":
      emitMapUpdateTo(writer, value, patch, target);
      return;
  }
}

function emitGuardUpdateTo(
  writer: CodeWriter,
  state: EmitState,
  node: Extract<UpdateIRNode, { readonly kind: "guard" }>,
  value: string,
  patch: string,
  target: string
): void {
  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch} !== undefined && !Object.is(${value}, ${patch})) {`);
  writer.indent(() => {
    writer.line(`if (!(${emitGuardTest(node.optional, node.nullable, patch)})) {`);
    writer.indent(() => writer.line(`${target} = ${patch};`));
    writer.line(`} else if (!(${emitGuardTest(node.optional, node.nullable, value)})) {`);
    writer.indent(() => writer.line(`${target} = ${patch};`));
    writer.line("} else {");
    writer.indent(() => {
      const inner = state.nextVar(`${target}_inner`);
      emitUpdateTo(writer, state, node.inner, value, patch, inner);
      writer.line(`${target} = ${inner};`);
    });
    writer.line("}");
  });
  writer.line("}");
}

function emitObjectUpdateTo(
  writer: CodeWriter,
  state: EmitState,
  node: Extract<UpdateIRNode, { readonly kind: "object" }>,
  value: string,
  patch: string,
  target: string
): void {
  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch} !== undefined) {`);
  writer.indent(() => {
    const entries: string[] = [];
    const changedVars: string[] = [];

    for (const prop of node.props) {
      const rawPropValue = emitPropertyAccess(value, prop.key);
      const defaultedPropValue = emitDefaultedValue(prop.schema, rawPropValue);
      const propValue = defaultedPropValue === rawPropValue ? rawPropValue : state.nextVar(`value_${prop.key}`);
      const propPatch = emitPropertyAccess(patch, prop.key);
      const propNext = state.nextVar(`next_${prop.key}`);

      if (propValue !== rawPropValue) {
        writer.line(`const ${propValue} = ${defaultedPropValue};`);
      }

      emitUpdateTo(writer, state, prop.value, propValue, propPatch, propNext);
      changedVars.push(`${propNext} !== ${propValue}`);
      entries.push(`${emitLiteral(prop.key)}: ${propNext}`);
    }

    writer.line(`if (${changedVars.join(" || ")}) {`);
    writer.indent(() => writer.line(`${target} = { ${entries.join(", ")} };`));
    writer.line("}");
  });
  writer.line("}");
}

function emitUnionUpdateTo(
  writer: CodeWriter,
  state: EmitState,
  node: Extract<UpdateIRNode, { readonly kind: "union" }>,
  value: string,
  patch: string,
  target: string
): void {
  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch} !== undefined && !Object.is(${value}, ${patch})) {`);
  writer.indent(() => {
    if (node.options.length === 0) {
      writer.line(`${target} = ${patch};`);
      return;
    }

    let prefix = "if";

    for (const option of node.options) {
      writer.line(`${prefix} (${emitSchemaGuard(option.schema, value)}) {`);
      writer.indent(() => {
        const next = state.nextVar(`${target}_branch`);

        emitUpdateTo(writer, state, option.node, value, patch, next);
        writer.line(`${target} = ${next};`);
      });
      prefix = "} else if";
    }

    writer.line("} else {");
    writer.indent(() => writer.line(`${target} = ${patch};`));
    writer.line("}");
  });
  writer.line("}");
}

function emitDiscriminatedUnionUpdateTo(
  writer: CodeWriter,
  state: EmitState,
  node: Extract<UpdateIRNode, { readonly kind: "discriminatedUnion" }>,
  value: string,
  patch: string,
  target: string
): void {
  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch} !== undefined && !Object.is(${value}, ${patch})) {`);
  writer.indent(() => {
    if (node.options.length === 0) {
      writer.line(`${target} = ${patch};`);
      return;
    }

    let prefix = "if";

    for (const option of node.options) {
      writer.line(`${prefix} (${emitSchemaGuard(option.schema, value)}) {`);
      writer.indent(() => {
        const tag = literalDiscriminatorValue(option.schema, node.discriminator);
        const next = state.nextVar(`${target}_branch`);

        if (tag !== undefined) {
          const patchTag = emitPropertyAccess(patch, node.discriminator);

          writer.line(`if (${patchTag} !== undefined && ${patchTag} !== ${emitLiteral(tag)}) {`);
          writer.indent(() => writer.line(`${target} = ${patch};`));
          writer.line("} else {");
          writer.indent(() => {
            emitUpdateTo(writer, state, option.node, value, patch, next);
            writer.line(`${target} = ${next};`);
          });
          writer.line("}");
          return;
        }

        emitUpdateTo(writer, state, option.node, value, patch, next);
        writer.line(`${target} = ${next};`);
      });
      prefix = "} else if";
    }

    writer.line("} else {");
    writer.indent(() => writer.line(`${target} = ${patch};`));
    writer.line("}");
  });
  writer.line("}");
}

function emitTupleUpdateTo(
  writer: CodeWriter,
  state: EmitState,
  node: Extract<UpdateIRNode, { readonly kind: "tuple" }>,
  value: string,
  patch: string,
  target: string
): void {
  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch} !== undefined) {`);
  writer.indent(() => {
    const entries: string[] = [];
    const changedVars: string[] = [];

    for (let index = 0; index < node.items.length; index++) {
      const itemNext = state.nextVar(`next_${index}`);

      emitUpdateTo(writer, state, node.items[index], `${value}[${index}]`, `${patch}[${index}]`, itemNext);
      changedVars.push(`${itemNext} !== ${value}[${index}]`);
      entries.push(itemNext);
    }

    writer.line(`if (${changedVars.join(" || ")}) {`);
    writer.indent(() => writer.line(`${target} = [${entries.join(", ")}];`));
    writer.line("}");
  });
  writer.line("}");
}

function emitArrayUpdateTo(
  writer: CodeWriter,
  state: EmitState,
  node: Extract<UpdateIRNode, { readonly kind: "array" }>,
  value: string,
  patch: string,
  target: string
): void {
  const len = state.nextVar("len");
  const patchLen = state.nextVar("patchLen");
  const index = state.nextVar("i");
  const item = state.nextVar("item");
  const patchItem = state.nextVar("patchItem");
  const next = state.nextVar("next");

  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch} !== undefined) {`);
  writer.indent(() => {
    writer.line(`const ${len} = ${value}.length;`);
    writer.line(`const ${patchLen} = ${patch}.length;`);
    writer.line(`for (let ${index} = 0; ${index} < ${patchLen}; ${index}++) {`);
    writer.indent(() => {
      writer.line(`const ${patchItem} = ${patch}[${index}];`);
      writer.line(`if (${patchItem} !== undefined) {`);
      writer.indent(() => {
        writer.line(`if (${index} >= ${len}) {`);
        writer.indent(() => {
          writer.line(`if (${target} === ${value}) {`);
          writer.indent(() => writer.line(`${target} = ${value}.slice();`));
          writer.line("}");
          writer.line(`${target}[${index}] = ${patchItem};`);
        });
        writer.line("} else {");
        writer.indent(() => {
          writer.line(`const ${item} = ${value}[${index}];`);
          emitUpdateTo(writer, state, node.element, item, patchItem, next);
          writer.line(`if (${next} !== ${item}) {`);
          writer.indent(() => {
            writer.line(`if (${target} === ${value}) {`);
            writer.indent(() => writer.line(`${target} = ${value}.slice();`));
            writer.line("}");
            writer.line(`${target}[${index}] = ${next};`);
          });
          writer.line("}");
        });
        writer.line("}");
      });
      writer.line("}");
    });
    writer.line("}");
  });
  writer.line("}");
}

function emitRecordUpdateTo(
  writer: CodeWriter,
  state: EmitState,
  node: Extract<UpdateIRNode, { readonly kind: "record" }>,
  value: string,
  patch: string,
  target: string
): void {
  const keys = state.nextVar("keys");
  const patchKeys = state.nextVar("patchKeys");
  const len = state.nextVar("len");
  const index = state.nextVar("i");
  const key = state.nextVar("key");
  const next = state.nextVar("next");
  const recordOut = state.nextVar("recordOut");

  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch} !== undefined && !Object.is(${value}, ${patch})) {`);
  writer.indent(() => {
    writer.line(`let changed = false;`);
    writer.line(`const ${keys} = Object.keys(${value});`);
    writer.line(`const ${patchKeys} = Object.keys(${patch});`);
    writer.line(`if (${keys}.length !== ${patchKeys}.length) {`);
    writer.indent(() => writer.line("changed = true;"));
    writer.line("}");
    writer.line(`for (let ${index} = 0, ${len} = ${patchKeys}.length; ${index} < ${len}; ${index}++) {`);
    writer.indent(() => {
      writer.line(`const ${key} = ${patchKeys}[${index}];`);
      emitUpdateTo(writer, state, node.value, `${value}[${key}]`, `${patch}[${key}]`, next);
      writer.line(`if (${next} !== ${value}[${key}]) {`);
      writer.indent(() => {
        writer.line("changed = true;");
        writer.line("break;");
      });
      writer.line("}");
    });
    writer.line("}");
    writer.line("if (changed) {");
    writer.indent(() => {
      writer.line(`const ${recordOut} = {};`);
      writer.line(`for (let ${index} = 0, ${len} = ${patchKeys}.length; ${index} < ${len}; ${index}++) {`);
      writer.indent(() => {
        writer.line(`const ${key} = ${patchKeys}[${index}];`);
        emitUpdateTo(writer, state, node.value, `${value}[${key}]`, `${patch}[${key}]`, next);
        writer.line(`${recordOut}[${key}] = ${next};`);
      });
      writer.line("}");
      writer.line(`${target} = ${recordOut};`);
    });
    writer.line("}");
  });
  writer.line("}");
}

function emitSetUpdateTo(writer: CodeWriter, value: string, patch: string, target: string): void {
  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch} !== undefined && !Object.is(${value}, ${patch})) {`);
  writer.indent(() => {
    writer.line(`if (${value}.size !== ${patch}.size) {`);
    writer.indent(() => writer.line(`${target} = ${patch};`));
    writer.line("} else {");
    writer.indent(() => {
      writer.line(`const iter = ${patch}.values();`);
      writer.line("let step = iter.next();");
      writer.line("while (!step.done) {");
      writer.indent(() => {
        writer.line("const item = step.value;");
        writer.line(`if (!${value}.has(item)) {`);
        writer.indent(() => {
          writer.line(`${target} = ${patch};`);
          writer.line("break;");
        });
        writer.line("}");
        writer.line("step = iter.next();");
      });
      writer.line("}");
    });
    writer.line("}");
  });
  writer.line("}");
}

function emitMapUpdateTo(writer: CodeWriter, value: string, patch: string, target: string): void {
  writer.line(`let ${target} = ${value};`);
  writer.line(`if (${patch} !== undefined && !Object.is(${value}, ${patch})) {`);
  writer.indent(() => {
    writer.line(`if (${value}.size !== ${patch}.size) {`);
    writer.indent(() => writer.line(`${target} = ${patch};`));
    writer.line("} else {");
    writer.indent(() => {
      writer.line(`const iter = ${patch}.entries();`);
      writer.line("let step = iter.next();");
      writer.line("while (!step.done) {");
      writer.indent(() => {
        writer.line("const entry = step.value;");
        writer.line("const key = entry[0];");
        writer.line("const nextValue = entry[1];");
        writer.line(`if (!${value}.has(key) || !Object.is(${value}.get(key), nextValue)) {`);
        writer.indent(() => {
          writer.line(`${target} = ${patch};`);
          writer.line("break;");
        });
        writer.line("}");
        writer.line("step = iter.next();");
      });
      writer.line("}");
    });
    writer.line("}");
  });
  writer.line("}");
}
