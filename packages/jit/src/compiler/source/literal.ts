import { Parse } from "../../shared/index.js";
import type { IRLiteralValue } from "../ir/ir.js";

export function emitLiteral(value: IRLiteralValue): string {
  switch (typeof value) {
    case "string":
      return Parse.parseKey(value, { parseAsJson: true });
    case "bigint":
      return `${value}n`;
    case "undefined":
      return "undefined";
    default:
      return String(value);
  }
}
