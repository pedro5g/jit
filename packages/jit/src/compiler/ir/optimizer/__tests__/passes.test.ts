import type { IRNode, IRProgram } from "../../ir.js";
import { irVar, literal, loadProp, not, notStrictEqual, strictEqual } from "../../ir.js";
import { dedupeHash } from "../passes/dedupe-hash.js";
import { dedupeLoads } from "../passes/dedupe-loads.js";
import { eliminateDead } from "../passes/eliminate-dead.js";
import { flattenBlocks } from "../passes/flatten-blocks.js";
import { hoistHash } from "../passes/hoist-hash.js";
import { inlineVars } from "../passes/inline-vars.js";
import { loopSimplify } from "../passes/loop-simplify.js";
import { reorderCompares } from "../passes/reorder-compares.js";

const l = irVar("l");
const r = irVar("r");

function program(body: readonly IRNode[]): IRProgram {
  return { kind: "program", params: [l, r], body };
}

const returnFalse: IRNode = { kind: "return", value: literal(false) };
const returnTrue: IRNode = { kind: "return", value: literal(true) };

describe("IR optimizer passes", () => {
  describe("flattenBlocks", () => {
    it("splices nested block bodies into their parent", () => {
      const input = program([{ kind: "block", body: [{ kind: "block", body: [returnTrue] }] }]);

      expect(flattenBlocks(input).body).toEqual([returnTrue]);
    });

    it("flattens blocks inside if branches and loops", () => {
      const input = program([
        {
          kind: "if",
          test: strictEqual(l, r),
          then: [{ kind: "block", body: [returnTrue] }],
        },
      ]);

      const output = flattenBlocks(input);

      expect(output.body[0]).toEqual({
        kind: "if",
        test: strictEqual(l, r),
        then: [returnTrue],
      });
    });
  });

  describe("eliminateDead", () => {
    it("removes if nodes whose test is statically false", () => {
      const input = program([{ kind: "if", test: not(literal(true)), then: [returnFalse] }, returnTrue]);

      expect(eliminateDead(input).body).toEqual([returnTrue]);
    });

    it("keeps reachable branches untouched", () => {
      const reachable: IRNode = { kind: "if", test: strictEqual(l, r), then: [returnTrue] };

      expect(eliminateDead(program([reachable, returnFalse])).body).toEqual([reachable, returnFalse]);
    });
  });

  describe("dedupeLoads", () => {
    it("reuses the first variable assigned to an identical load", () => {
      const first = irVar("a");
      const second = irVar("b");
      const input = program([
        { kind: "assign", target: first, expr: loadProp(l, "id") },
        { kind: "assign", target: second, expr: loadProp(l, "id") },
      ]);

      const output = dedupeLoads(input);

      expect(output.body[0]).toEqual({ kind: "assign", target: first, expr: loadProp(l, "id") });
      expect(output.body[1]).toEqual({ kind: "assign", target: second, expr: first });
    });

    it("does not leak loads across loop-body boundaries", () => {
      const outer = irVar("a");
      const inner = irVar("b");
      const index = irVar("i");
      const input = program([
        { kind: "assign", target: outer, expr: loadProp(l, "id") },
        {
          kind: "for",
          index,
          from: literal(0),
          body: [{ kind: "assign", target: inner, expr: loadProp(l, "id") }],
        },
      ]);

      const output = dedupeLoads(input);
      const loop = output.body[1];

      if (loop.kind !== "for") throw new Error("expected for node");
      // The loop body re-loads instead of reusing the outer binding.
      expect(loop.body[0]).toEqual({ kind: "assign", target: inner, expr: loadProp(l, "id") });
    });
  });

  describe("inlineVars", () => {
    it("inlines single-use side-effect-free assignments", () => {
      const tmp = irVar("tmp");
      const input = program([
        { kind: "assign", target: tmp, expr: loadProp(l, "id") },
        { kind: "return", value: strictEqual(tmp, loadProp(r, "id")) },
      ]);

      const output = inlineVars(input);

      expect(output.body).toEqual([{ kind: "return", value: strictEqual(loadProp(l, "id"), loadProp(r, "id")) }]);
    });

    it("keeps variables that are used more than once", () => {
      const tmp = irVar("tmp");
      const input = program([
        { kind: "assign", target: tmp, expr: loadProp(l, "id") },
        { kind: "if", test: strictEqual(tmp, literal(1)), then: [returnFalse] },
        { kind: "return", value: strictEqual(tmp, loadProp(r, "id")) },
      ]);

      const output = inlineVars(input);

      expect(output.body[0]).toEqual({ kind: "assign", target: tmp, expr: loadProp(l, "id") });
    });

    it("never inlines calls", () => {
      const tmp = irVar("tmp");
      const input = program([
        { kind: "assign", target: tmp, expr: { kind: "call", callee: irVar("__hash"), args: [l] } },
        { kind: "return", value: tmp },
      ]);

      const output = inlineVars(input);

      expect(output.body).toHaveLength(2);
      expect(output.body[0].kind).toBe("assign");
    });
  });

  describe("loopSimplify", () => {
    it("drops loops and ifs whose bodies became empty", () => {
      const index = irVar("i");
      const input = program([
        { kind: "for", index, from: literal(0), body: [] },
        { kind: "if", test: strictEqual(l, r), then: [] },
        returnTrue,
      ]);

      expect(loopSimplify(input).body).toEqual([returnTrue]);
    });
  });

  describe("reorderCompares", () => {
    it("sorts adjacent early-return compares from cheapest to most expensive", () => {
      const expensive: IRNode = {
        kind: "if",
        test: notStrictEqual(loadProp(loadProp(l, "profile"), "email"), loadProp(loadProp(r, "profile"), "email")),
        then: [returnFalse],
      };
      const cheap: IRNode = {
        kind: "if",
        test: notStrictEqual(loadProp(l, "id"), loadProp(r, "id")),
        then: [returnFalse],
      };

      const output = reorderCompares(program([expensive, cheap, returnTrue]));

      expect(output.body).toEqual([cheap, expensive, returnTrue]);
    });

    it("never reorders across an impure boundary", () => {
      const pure: IRNode = {
        kind: "if",
        test: notStrictEqual(loadProp(l, "id"), loadProp(r, "id")),
        then: [returnFalse],
      };
      const impure: IRNode = {
        kind: "if",
        test: { kind: "call", callee: irVar("__hash"), args: [l] },
        then: [returnFalse],
      };

      const output = reorderCompares(program([impure, pure, returnTrue]));

      expect(output.body).toEqual([impure, pure, returnTrue]);
    });
  });

  describe("identity placeholders", () => {
    it("dedupeHash and hoistHash currently return the program unchanged", () => {
      const input = program([returnTrue]);

      expect(dedupeHash(input)).toBe(input);
      expect(hoistHash(input)).toBe(input);
    });
  });
});
