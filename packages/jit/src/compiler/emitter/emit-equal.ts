import type { IRNode, IRProgram } from "../ir/ir.js";
import { emitPropertyAccess } from "../source/access.js";
import { emitLiteral } from "../source/literal.js";
import { CodeWriter } from "./code-writer.js";
import { emitExpr } from "./emit-expr.js";

export function emitEqual(program: IRProgram): string {
  const writer = new CodeWriter();
  const [left, right] = program.params;

  writer.line(`function equal(${left.name}, ${right.name}) {`);
  writer.indent(() => {
    for (const node of program.body) emitNode(writer, node);
  });
  writer.line("}");

  return writer.toString();
}

export function emitEqualBody(program: IRProgram): string {
  const writer = new CodeWriter();

  for (const node of program.body) emitNode(writer, node);

  return writer.toString();
}

function emitNode(writer: CodeWriter, node: IRNode): void {
  switch (node.kind) {
    case "block":
      for (const child of node.body) emitNode(writer, child);
      return;
    case "assign":
      writer.line(`const ${node.target.name} = ${emitExpr(node.expr)};`);
      return;
    case "hash_compare":
      writer.line(`if (${emitExpr(node.leftHash)} !== ${emitExpr(node.rightHash)}) {`);
      writer.indent(() => {
        writer.line("return false;");
      });
      writer.line("}");
      return;
    case "map_equal":
      emitMapEqual(writer, node);
      return;
    case "binary_search_equal":
      emitBinarySearchEqual(writer, node);
      return;
    case "if":
      writer.line(`if (${emitExpr(node.test)}) {`);
      writer.indent(() => {
        for (const child of node.then) emitNode(writer, child);
      });
      if (node.otherwise && node.otherwise.length > 0) {
        writer.line("} else {");
        writer.indent(() => {
          for (const child of node.otherwise ?? []) emitNode(writer, child);
        });
      }
      writer.line("}");
      return;
    case "for":
      writer.line(`for (let ${node.index.name} = ${emitExpr(node.from)}; ${node.index.name}-- !== 0;) {`);
      writer.indent(() => {
        for (const child of node.body) emitNode(writer, child);
      });
      writer.line("}");
      return;
    case "return":
      writer.line(`return ${emitExpr(node.value)};`);
      return;
  }
}

function emitMapEqual(writer: CodeWriter, node: Extract<IRNode, { readonly kind: "map_equal" }>): void {
  writer.line(`const ${node.length.name} = ${emitExpr(node.left)}.length;`);
  writer.line(`if (${node.length.name} !== ${emitExpr(node.right)}.length) {`);
  writer.indent(() => {
    writer.line("return false;");
  });
  writer.line("}");
  writer.line(`const ${node.rightIndex.name} = __getIndex(${emitExpr(node.right)}, ${emitLiteral(node.key)});`);
  writer.line(`for (let ${node.index.name} = ${node.length.name}; ${node.index.name}-- !== 0;) {`);
  writer.indent(() => {
    writer.line(`const ${node.leftItem.name} = ${emitExpr(node.left)}[${node.index.name}];`);
    writer.line(
      `const ${node.rightItem.name} = ${node.rightIndex.name}.get(${emitPropertyAccess(node.leftItem.name, node.key)});`
    );
    writer.line(
      `if (${node.rightItem.name} === undefined && !${node.rightIndex.name}.has(${emitPropertyAccess(node.leftItem.name, node.key)})) {`
    );
    writer.indent(() => {
      writer.line("return false;");
    });
    writer.line("}");
    for (const child of node.body) emitNode(writer, child);
  });
  writer.line("}");
}

function emitBinarySearchEqual(
  writer: CodeWriter,
  node: Extract<IRNode, { readonly kind: "binary_search_equal" }>
): void {
  const compareLeft = node.direction === "desc" ? ">" : "<";
  writer.line(`const ${node.length.name} = ${emitExpr(node.left)}.length;`);
  writer.line(`if (${node.length.name} !== ${emitExpr(node.right)}.length) {`);
  writer.indent(() => {
    writer.line("return false;");
  });
  writer.line("}");
  writer.line(`for (let ${node.index.name} = ${node.length.name}; ${node.index.name}-- !== 0;) {`);
  writer.indent(() => {
    writer.line(`const ${node.leftItem.name} = ${emitExpr(node.left)}[${node.index.name}];`);
    writer.line(`let ${node.searchLow.name} = 0;`);
    writer.line(`let ${node.searchHigh.name} = ${node.length.name} - 1;`);
    writer.line(`let ${node.rightItem.name};`);
    writer.line(`while (${node.searchLow.name} <= ${node.searchHigh.name}) {`);
    writer.indent(() => {
      writer.line(`const ${node.searchMid.name} = (${node.searchLow.name} + ${node.searchHigh.name}) >> 1;`);
      writer.line(`const ${node.found.name} = ${emitExpr(node.right)}[${node.searchMid.name}];`);
      writer.line(
        `if (${emitPropertyAccess(node.found.name, node.key)} === ${emitPropertyAccess(node.leftItem.name, node.key)}) {`
      );
      writer.indent(() => {
        writer.line(`${node.rightItem.name} = ${node.found.name};`);
        writer.line("break;");
      });
      writer.line("}");
      writer.line(
        `if (${emitPropertyAccess(node.found.name, node.key)} ${compareLeft} ${emitPropertyAccess(node.leftItem.name, node.key)}) {`
      );
      writer.indent(() => {
        writer.line(`${node.searchLow.name} = ${node.searchMid.name} + 1;`);
      });
      writer.line("} else {");
      writer.indent(() => {
        writer.line(`${node.searchHigh.name} = ${node.searchMid.name} - 1;`);
      });
      writer.line("}");
    });
    writer.line("}");
    writer.line(`if (${node.rightItem.name} === undefined) {`);
    writer.indent(() => {
      writer.line("return false;");
    });
    writer.line("}");
    for (const child of node.body) emitNode(writer, child);
  });
  writer.line("}");
}
