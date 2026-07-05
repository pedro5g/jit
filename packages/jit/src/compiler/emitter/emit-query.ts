import type { IRProgram } from "../ir/ir.js";
import { CodeWriter } from "./code-writer.js";
import { emitNode } from "./emit-node.js";

export function emitQuery(program: IRProgram): string {
  const writer = new CodeWriter();
  const [value] = program.params;

  writer.line(`function query(${value.name}) {`);
  writer.indent(() => {
    for (const node of program.body) emitNode(writer, node);
  });
  writer.line("}");

  return writer.toString();
}
