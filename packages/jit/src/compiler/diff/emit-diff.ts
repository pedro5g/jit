import { CodeWriter } from "../emitter/code-writer.js";
import { createEmitState, type EmitState } from "../emitter/emit-state.js";
import { emitGuardTest } from "../schema-nodes.js";
import { emitPropertyAccess } from "../source/access.js";
import { emitLiteral } from "../source/literal.js";
import type { DiffIRNode, DiffIRProgram } from "./build-diff-ir.js";

type PathPart = string | number | { readonly expr: string };

export function emitDiff(program: DiffIRProgram): string {
  const writer = new CodeWriter();

  writer.line(`function diff(${program.leftParam}, ${program.rightParam}) {`);
  writer.indent(() =>
    emitDiffBodyLines(writer, createEmitState(), program.body, program.leftParam, program.rightParam)
  );
  writer.line("}");

  return writer.toString();
}

export function emitDiffBody(program: DiffIRProgram): string {
  const writer = new CodeWriter();

  emitDiffBodyLines(writer, createEmitState(), program.body, program.leftParam, program.rightParam);

  return writer.toString();
}

function emitDiffBodyLines(writer: CodeWriter, state: EmitState, node: DiffIRNode, left: string, right: string): void {
  writer.line("const changes = [];");
  writer.line(`if (Object.is(${left}, ${right})) {`);
  writer.indent(() => writer.line("return changes;"));
  writer.line("}");
  emitDiffNode(writer, state, node, left, right, []);
  writer.line("return changes;");
}

function emitDiffNode(
  writer: CodeWriter,
  state: EmitState,
  node: DiffIRNode,
  left: string,
  right: string,
  path: readonly PathPart[]
): void {
  switch (node.kind) {
    case "reuse":
      writer.line(`if (!Object.is(${left}, ${right})) {`);
      writer.indent(() => emitChange(writer, "update", path, right));
      writer.line("}");
      return;
    case "date":
      writer.line(`if (${left}.getTime() !== ${right}.getTime()) {`);
      writer.indent(() => emitChange(writer, "update", path, right));
      writer.line("}");
      return;
    case "guard":
      emitGuardDiff(writer, state, node, left, right, path);
      return;
    case "object":
      emitObjectDiff(writer, state, node, left, right, path);
      return;
    case "array":
      emitArrayDiff(writer, state, node, left, right, path);
      return;
    case "tuple":
      emitTupleDiff(writer, state, node, left, right, path);
      return;
    case "record":
      emitRecordDiff(writer, state, node, left, right, path);
      return;
    case "set":
      emitSetDiff(writer, state, left, right, path);
      return;
    case "map":
      emitMapDiff(writer, state, left, right, path);
      return;
  }
}

function emitGuardDiff(
  writer: CodeWriter,
  state: EmitState,
  node: Extract<DiffIRNode, { readonly kind: "guard" }>,
  left: string,
  right: string,
  path: readonly PathPart[]
): void {
  writer.line(`if (!Object.is(${left}, ${right})) {`);
  writer.indent(() => {
    writer.line(
      `if (!(${emitGuardTest(node.optional, node.nullable, left)}) || !(${emitGuardTest(
        node.optional,
        node.nullable,
        right
      )})) {`
    );
    writer.indent(() => emitChange(writer, "update", path, right));
    writer.line("} else {");
    writer.indent(() => emitDiffNode(writer, state, node.inner, left, right, path));
    writer.line("}");
  });
  writer.line("}");
}

function emitObjectDiff(
  writer: CodeWriter,
  state: EmitState,
  node: Extract<DiffIRNode, { readonly kind: "object" }>,
  left: string,
  right: string,
  path: readonly PathPart[]
): void {
  writer.line(`if (!Object.is(${left}, ${right})) {`);
  writer.indent(() => {
    for (const prop of node.props) {
      emitDiffNode(writer, state, prop.value, emitPropertyAccess(left, prop.key), emitPropertyAccess(right, prop.key), [
        ...path,
        prop.key,
      ]);
    }
  });
  writer.line("}");
}

function emitTupleDiff(
  writer: CodeWriter,
  state: EmitState,
  node: Extract<DiffIRNode, { readonly kind: "tuple" }>,
  left: string,
  right: string,
  path: readonly PathPart[]
): void {
  writer.line(`if (!Object.is(${left}, ${right})) {`);
  writer.indent(() => {
    for (let index = 0; index < node.items.length; index++) {
      emitDiffNode(writer, state, node.items[index], `${left}[${index}]`, `${right}[${index}]`, [...path, index]);
    }
  });
  writer.line("}");
}

function emitArrayDiff(
  writer: CodeWriter,
  state: EmitState,
  node: Extract<DiffIRNode, { readonly kind: "array" }>,
  left: string,
  right: string,
  path: readonly PathPart[]
): void {
  const leftLen = state.nextVar("leftLen");
  const rightLen = state.nextVar("rightLen");
  const commonLen = state.nextVar("commonLen");
  const index = state.nextVar("i");

  writer.line(`if (!Object.is(${left}, ${right})) {`);
  writer.indent(() => {
    writer.line(`const ${leftLen} = ${left}.length;`);
    writer.line(`const ${rightLen} = ${right}.length;`);
    writer.line(`const ${commonLen} = ${leftLen} < ${rightLen} ? ${leftLen} : ${rightLen};`);
    writer.line(`for (let ${index} = 0; ${index} < ${commonLen}; ${index}++) {`);
    writer.indent(() => {
      emitDiffNode(writer, state, node.element, `${left}[${index}]`, `${right}[${index}]`, [...path, { expr: index }]);
    });
    writer.line("}");
    writer.line(`for (let ${index} = ${commonLen}; ${index} < ${rightLen}; ${index}++) {`);
    writer.indent(() => emitChange(writer, "add", [...path, { expr: index }], `${right}[${index}]`));
    writer.line("}");
    writer.line(`for (let ${index} = ${commonLen}; ${index} < ${leftLen}; ${index}++) {`);
    writer.indent(() => emitChange(writer, "remove", [...path, { expr: index }]));
    writer.line("}");
  });
  writer.line("}");
}

function emitRecordDiff(
  writer: CodeWriter,
  state: EmitState,
  node: Extract<DiffIRNode, { readonly kind: "record" }>,
  left: string,
  right: string,
  path: readonly PathPart[]
): void {
  const leftKeys = state.nextVar("leftKeys");
  const rightKeys = state.nextVar("rightKeys");
  const len = state.nextVar("len");
  const index = state.nextVar("i");
  const key = state.nextVar("key");

  writer.line(`if (!Object.is(${left}, ${right})) {`);
  writer.indent(() => {
    writer.line(`const ${leftKeys} = Object.keys(${left});`);
    writer.line(`const ${rightKeys} = Object.keys(${right});`);
    writer.line(`for (let ${index} = 0, ${len} = ${rightKeys}.length; ${index} < ${len}; ${index}++) {`);
    writer.indent(() => {
      writer.line(`const ${key} = ${rightKeys}[${index}];`);
      writer.line(`if (!Object.prototype.hasOwnProperty.call(${left}, ${key})) {`);
      writer.indent(() => emitChange(writer, "add", [...path, { expr: key }], `${right}[${key}]`));
      writer.line("} else {");
      writer.indent(() =>
        emitDiffNode(writer, state, node.value, `${left}[${key}]`, `${right}[${key}]`, [...path, { expr: key }])
      );
      writer.line("}");
    });
    writer.line("}");
    writer.line(`for (let ${index} = 0, ${len} = ${leftKeys}.length; ${index} < ${len}; ${index}++) {`);
    writer.indent(() => {
      writer.line(`const ${key} = ${leftKeys}[${index}];`);
      writer.line(`if (!Object.prototype.hasOwnProperty.call(${right}, ${key})) {`);
      writer.indent(() => emitChange(writer, "remove", [...path, { expr: key }]));
      writer.line("}");
    });
    writer.line("}");
  });
  writer.line("}");
}

function emitSetDiff(
  writer: CodeWriter,
  state: EmitState,
  left: string,
  right: string,
  path: readonly PathPart[]
): void {
  const item = state.nextVar("item");
  const iter = state.nextVar("iter");
  const step = state.nextVar("step");

  writer.line(`if (!Object.is(${left}, ${right})) {`);
  writer.indent(() => {
    writer.line(`let changed = ${left}.size !== ${right}.size;`);
    writer.line("if (!changed) {");
    writer.indent(() => {
      writer.line(`const ${iter} = ${right}.values();`);
      writer.line(`let ${step} = ${iter}.next();`);
      writer.line(`while (!${step}.done) {`);
      writer.indent(() => {
        writer.line(`const ${item} = ${step}.value;`);
        writer.line(`if (!${left}.has(${item})) {`);
        writer.indent(() => {
          writer.line("changed = true;");
          writer.line("break;");
        });
        writer.line("}");
        writer.line(`${step} = ${iter}.next();`);
      });
      writer.line("}");
    });
    writer.line("}");
    writer.line("if (changed) {");
    writer.indent(() => emitChange(writer, "update", path, right));
    writer.line("}");
  });
  writer.line("}");
}

function emitMapDiff(
  writer: CodeWriter,
  state: EmitState,
  left: string,
  right: string,
  path: readonly PathPart[]
): void {
  const entry = state.nextVar("entry");
  const iter = state.nextVar("iter");
  const step = state.nextVar("step");
  const key = state.nextVar("key");
  const value = state.nextVar("value");

  writer.line(`if (!Object.is(${left}, ${right})) {`);
  writer.indent(() => {
    writer.line(`let changed = ${left}.size !== ${right}.size;`);
    writer.line("if (!changed) {");
    writer.indent(() => {
      writer.line(`const ${iter} = ${right}.entries();`);
      writer.line(`let ${step} = ${iter}.next();`);
      writer.line(`while (!${step}.done) {`);
      writer.indent(() => {
        writer.line(`const ${entry} = ${step}.value;`);
        writer.line(`const ${key} = ${entry}[0];`);
        writer.line(`const ${value} = ${entry}[1];`);
        writer.line(`if (!${left}.has(${key}) || !Object.is(${left}.get(${key}), ${value})) {`);
        writer.indent(() => {
          writer.line("changed = true;");
          writer.line("break;");
        });
        writer.line("}");
        writer.line(`${step} = ${iter}.next();`);
      });
      writer.line("}");
    });
    writer.line("}");
    writer.line("if (changed) {");
    writer.indent(() => emitChange(writer, "update", path, right));
    writer.line("}");
  });
  writer.line("}");
}

function emitChange(
  writer: CodeWriter,
  type: "add" | "remove" | "update",
  path: readonly PathPart[],
  value?: string
): void {
  const valuePart = value === undefined ? "" : `, value: ${value}`;
  writer.line(`changes[changes.length] = { type: ${emitLiteral(type)}, path: ${emitPath(path)}${valuePart} };`);
}

function emitPath(path: readonly PathPart[]): string {
  return `[${path.map(emitPathPart).join(", ")}]`;
}

function emitPathPart(part: PathPart): string {
  if (typeof part === "object") return part.expr;
  return emitLiteral(part);
}
