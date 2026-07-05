import type { IRExpr, IRNode } from "../ir/ir.js";
import { emitPropertyAccess } from "../source/access.js";
import { emitLiteral } from "../source/literal.js";
import type { CodeWriter } from "./code-writer.js";
import { emitConditionRaw, emitExpr } from "./emit-expr.js";

export function emitNode(writer: CodeWriter, node: IRNode): void {
  switch (node.kind) {
    case "block":
      for (const child of node.body) emitNode(writer, child);
      return;
    case "assign":
      writer.line(`const ${node.target.name} = ${emitExpr(node.expr)};`);
      return;
    case "let":
      if (node.expr === undefined) {
        writer.line(`let ${node.target.name};`);
      } else {
        writer.line(`let ${node.target.name} = ${emitExpr(node.expr)};`);
      }
      return;
    case "store":
      writer.line(`${emitExpr(node.target)} = ${emitExpr(node.expr)};`);
      return;
    case "expr_stmt":
      writer.line(`${emitExpr(node.expr)};`);
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
      writer.line(`if (${emitTestExpr(node.test)}) {`);
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
    case "for_range": {
      const index = node.index.name;
      writer.line(`for (let ${index} = 0; ${index} < ${emitExpr(node.length)}; ${index}++) {`);
      writer.indent(() => {
        for (const child of node.body) emitNode(writer, child);
      });
      writer.line("}");
      return;
    }
    case "for_of":
      writer.line(`for (const ${node.item.name} of ${emitExpr(node.iterable)}) {`);
      writer.indent(() => {
        for (const child of node.body) emitNode(writer, child);
      });
      writer.line("}");
      return;
    case "append":
      writer.line(`${node.target.name}[${node.cursor.name}++] = ${emitExpr(node.value)};`);
      return;
    case "sort_by_key":
      writer.line(`${node.target.name}.sort((left, right) => {`);
      writer.indent(() => {
        writer.line(`const leftValue = ${emitPropertyAccess("left", node.key)};`);
        writer.line(`const rightValue = ${emitPropertyAccess("right", node.key)};`);
        writer.line("if (leftValue === rightValue) return 0;");
        if (node.direction === "desc") {
          writer.line("return leftValue < rightValue ? 1 : -1;");
        } else {
          writer.line("return leftValue < rightValue ? -1 : 1;");
        }
      });
      writer.line("});");
      return;
    case "return":
      writer.line(`return ${emitExpr(node.value)};`);
      return;
  }
}

export function emitTestExpr(expr: IRExpr): string {
  if (expr.kind === "binary") {
    const left = emitExpr(expr.left);
    const right = emitExpr(expr.right);

    if (expr.op === "strictEqual") return `${left} === ${right}`;
    if (expr.op === "notStrictEqual") return `${left} !== ${right}`;
  }

  if (expr.kind === "nary") {
    const op = expr.op === "and" ? " && " : " || ";

    return expr.operands.map((operand) => `(${emitConditionRaw(operand)})`).join(op);
  }

  if (expr.kind === "not") {
    const inner = expr.expr;

    if (inner.kind === "sameNumber") {
      const left = emitExpr(inner.left);
      const right = emitExpr(inner.right);

      return `${left} !== ${right} && (${left} === ${left} || ${right} === ${right})`;
    }

    if (inner.kind === "sameValue") {
      return `!Object.is(${emitExpr(inner.left)}, ${emitExpr(inner.right)})`;
    }

    if (inner.kind === "binary" && inner.op === "strictEqual") {
      return `${emitExpr(inner.left)} !== ${emitExpr(inner.right)}`;
    }

    if (inner.kind === "call") {
      return `!${emitExpr(inner)}`;
    }

    if (inner.kind === "nary") {
      return `!(${emitTestExpr(inner)})`;
    }
  }

  return emitExpr(expr);
}

function emitMapEqual(writer: CodeWriter, node: Extract<IRNode, { readonly kind: "map_equal" }>): void {
  writer.line(`const ${node.length.name} = ${emitExpr(node.left)}.length;`);
  writer.line(`if (${node.length.name} !== ${emitExpr(node.right)}.length) {`);
  writer.indent(() => {
    writer.line("return false;");
  });
  writer.line("}");
  writer.line(`if (${node.length.name} < 64) {`);
  writer.indent(() => {
    writer.line(`for (let ${node.index.name} = 0; ${node.index.name} < ${node.length.name}; ${node.index.name}++) {`);
    writer.indent(() => {
      writer.line(`const ${node.leftItem.name} = ${emitExpr(node.left)}[${node.index.name}];`);
      writer.line("let found = false;");
      writer.line(`for (let j = 0; j < ${node.length.name}; j++) {`);
      writer.indent(() => {
        writer.line(`const ${node.rightItem.name} = ${emitExpr(node.right)}[j];`);
        writer.line(
          `if (${emitPropertyAccess(node.rightItem.name, node.key)} === ${emitPropertyAccess(node.leftItem.name, node.key)}) {`
        );
        writer.indent(() => {
          writer.line("found = true;");
          for (const child of node.body) emitNode(writer, child);
          writer.line("break;");
        });
        writer.line("}");
      });
      writer.line("}");
      writer.line("if (!found) {");
      writer.indent(() => {
        writer.line("return false;");
      });
      writer.line("}");
    });
    writer.line("}");
  });
  writer.line("} else {");
  writer.indent(() => {
    writer.line(`let ${node.rightIndex.name};`);
    writer.line(`${node.rightIndex.name} = __getIndex(${emitExpr(node.right)}, ${emitLiteral(node.key)});`);
    writer.line(`for (let ${node.index.name} = 0; ${node.index.name} < ${node.length.name}; ${node.index.name}++) {`);
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
  writer.line(`for (let ${node.index.name} = 0; ${node.index.name} < ${node.length.name}; ${node.index.name}++) {`);
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
