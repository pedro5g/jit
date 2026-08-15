import type { IRProgram } from "../ir/ir.js";
import { CodeWriter } from "./code-writer.js";
import { emitNode } from "./emit-node.js";

export function emitEqual(program: IRProgram): string {
  const writer = new CodeWriter();
  const [left, right] = program.params;

  emitHelpers(writer, program);
  writer.line(`function equal(${left.name}, ${right.name}) {`);
  writer.indent(() => {
    for (const node of program.body) emitNode(writer, node);
  });
  writer.line("}");

  return writer.toString();
}

export function emitEqualBody(program: IRProgram): string {
  const writer = new CodeWriter();

  emitHelpers(writer, program);
  for (const node of program.body) emitNode(writer, node);

  return writer.toString();
}

/** One named function per cycle participant, ahead of the entry point. */
function emitHelpers(writer: CodeWriter, program: IRProgram): void {
  for (const helper of program.helpers ?? []) {
    const [left, right] = helper.program.params;

    writer.line(`function ${helper.name}(${left.name}, ${right.name}) {`);
    writer.indent(() => {
      for (const node of helper.program.body) emitNode(writer, node);
    });
    writer.line("}");
  }
}
