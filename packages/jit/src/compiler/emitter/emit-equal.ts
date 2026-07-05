import type { IRProgram } from "../ir/ir.js";
import { CodeWriter } from "./code-writer.js";
import { emitNode } from "./emit-node.js";

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
