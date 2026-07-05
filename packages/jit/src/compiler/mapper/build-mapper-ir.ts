import {
  construct,
  forRange,
  type IRExpr,
  type IRNode,
  type IRProgram,
  irVar,
  letDecl,
  literal,
  loadIndex,
  loadProp,
  notStrictEqual,
  objectLiteral,
  store,
  strictEqual,
} from "../ir/ir.js";
import type { MapperFieldPlan } from "./build-mapper-plan.js";

const SOURCE = irVar("source");
const LIST = irVar("list");
const LEN = irVar("len");
const OUT = irVar("out");
const INDEX = irVar("i");

export interface MapperPrograms {
  readonly map: IRProgram;
  readonly many: IRProgram;
}

/**
 * Lowers a mapper field plan into two IR programs sharing the same inline
 * output literal: `map` (single object) and `many` (fused indexed loop, one
 * output allocation, no per-item function call).
 */
export function buildMapperIR(fields: readonly MapperFieldPlan[]): MapperPrograms {
  const prelude: IRNode[] = [];
  const output = objectLiteral(buildEntries(fields, SOURCE, "f", prelude));

  const map: IRProgram = {
    kind: "program",
    params: [SOURCE],
    body: [...prelude, { kind: "return", value: output }],
  };

  const many: IRProgram = {
    kind: "program",
    params: [LIST],
    body: [
      { kind: "assign", target: LEN, expr: loadProp(LIST, "length") },
      { kind: "assign", target: OUT, expr: construct("Array", [LEN]) },
      forRange(INDEX, LEN, [
        { kind: "assign", target: SOURCE, expr: loadIndex(LIST, INDEX) },
        ...prelude,
        store(loadIndex(OUT, INDEX), output),
      ]),
      { kind: "return", value: OUT },
    ],
  };

  return { map, many };
}

function buildEntries(
  fields: readonly MapperFieldPlan[],
  base: IRExpr,
  prefix: string,
  prelude: IRNode[]
): { readonly key: string; readonly value: IRExpr }[] {
  return fields.map((field) => ({
    key: field.key,
    value: buildFieldValue(field, base, `${prefix}_${identifier(field.key)}`, prelude),
  }));
}

function buildFieldValue(field: MapperFieldPlan, base: IRExpr, prefix: string, prelude: IRNode[]): IRExpr {
  const source = field.source;

  switch (source.kind) {
    case "copy":
      return loadProp(base, source.from);
    case "copy-object": {
      if (!source.fromOptional) {
        return objectLiteral(buildEntries(source.fields, loadProp(base, source.from), prefix, prelude));
      }

      const src = irVar(`${prefix}_src`);
      const value = irVar(`${prefix}_val`);
      const inner: IRNode[] = [];
      const nested = objectLiteral(buildEntries(source.fields, src, prefix, inner));

      prelude.push({ kind: "assign", target: src, expr: loadProp(base, source.from) }, letDecl(value), {
        kind: "if",
        test: notStrictEqual(src, literal(undefined)),
        then: [...inner, store(value, nested)],
      });
      return value;
    }
    case "copy-array": {
      const src = irVar(`${prefix}_src`);
      const len = irVar(`${prefix}_len`);
      const out = irVar(`${prefix}_out`);
      const index = irVar(`${prefix}_i`);
      const item = irVar(`${prefix}_item`);
      const inner: IRNode[] = [];
      const element =
        source.element === undefined ? item : objectLiteral(buildEntries(source.element, item, prefix, inner));
      const loop: IRNode[] = [
        { kind: "assign", target: len, expr: loadProp(src, "length") },
        { kind: "assign", target: out, expr: construct("Array", [len]) },
        forRange(index, len, [
          { kind: "assign", target: item, expr: loadIndex(src, index) },
          ...inner,
          store(loadIndex(out, index), element),
        ]),
      ];

      if (!source.fromOptional) {
        prelude.push({ kind: "assign", target: src, expr: loadProp(base, source.from) }, ...loop);
        return out;
      }

      const value = irVar(`${prefix}_val`);

      prelude.push({ kind: "assign", target: src, expr: loadProp(base, source.from) }, letDecl(value), {
        kind: "if",
        test: notStrictEqual(src, literal(undefined)),
        then: [...loop, store(value, out)],
      });
      return value;
    }
    case "via":
      return { kind: "call", callee: irVar(source.binding), args: [loadProp(SOURCE, source.from), SOURCE] };
    case "computed":
      return { kind: "call", callee: irVar(source.binding), args: [SOURCE] };
    case "default": {
      if (source.from === undefined) return irVar(source.binding);

      const value = irVar(`${prefix}_val`);

      prelude.push(letDecl(value, loadProp(SOURCE, source.from)), {
        kind: "if",
        test: strictEqual(value, literal(undefined)),
        then: [store(value, irVar(source.binding))],
      });
      return value;
    }
  }
}

function identifier(key: string): string {
  return key.replace(/[^$_a-zA-Z0-9]/g, "_").replace(/^[^$_a-zA-Z]/, "_");
}
