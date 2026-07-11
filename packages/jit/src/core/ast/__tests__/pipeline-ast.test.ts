import type { PipelineAST } from "../../../index.js";
import { JIT } from "../../../index.js";

describe("PipelineAST", () => {
  const Users = JIT.array(
    JIT.object({
      id: JIT.number(),
      name: JIT.string(),
      role: JIT.string(),
    })
  );

  describe("query condition nodes", () => {
    it("builds compare nodes with field/binding value nodes", () => {
      let captured: PipelineAST.QueryConditionNode | undefined;

      JIT.query(Users).filter((c) => {
        captured = c.eq("role", "admin");
        return captured;
      });

      expect(captured).toEqual({
        kind: "compare",
        op: "eq",
        left: { kind: "field", key: "role" },
        right: { kind: "binding", name: "__q0" },
      });
    });

    it("builds logical and not nodes recursively", () => {
      let captured: PipelineAST.QueryConditionNode | undefined;

      JIT.query(Users).filter((c) => {
        captured = c.not(c.and(c.eq("role", "admin"), c.gt("id", 10)));
        return captured;
      });

      expect(captured).toMatchObject({
        kind: "not",
        inner: {
          kind: "logical",
          op: "and",
          left: { kind: "compare", op: "eq" },
          right: { kind: "compare", op: "gt" },
        },
      });
    });

    it("allocates one binding per literal in declaration order", () => {
      let first: PipelineAST.QueryCompareNode | undefined;
      let second: PipelineAST.QueryCompareNode | undefined;

      JIT.query(Users).filter((c) => {
        first = c.eq("role", "admin");
        second = c.lt("id", 100);
        return c.and(first, second);
      });

      expect(first?.right).toEqual({ kind: "binding", name: "__q0" });
      expect(second?.right).toEqual({ kind: "binding", name: "__q1" });
    });
  });

  describe("node type contracts", () => {
    it("keeps discriminated unions closed over their kinds", () => {
      expectTypeOf<PipelineAST.QueryValueNode["kind"]>().toEqualTypeOf<"field" | "literal" | "binding" | "param">();
      expectTypeOf<PipelineAST.QueryConditionNode["kind"]>().toEqualTypeOf<"compare" | "logical" | "not">();
      expectTypeOf<PipelineAST.QueryCompareOperator>().toEqualTypeOf<"eq" | "neq" | "gt" | "gte" | "lt" | "lte">();
      expectTypeOf<PipelineAST.UpdateNode>().toEqualTypeOf<PipelineAST.UpdateSetNode>();
      expectTypeOf<PipelineAST.UpdateSetNode["kind"]>().toEqualTypeOf<"set">();
      expectTypeOf<PipelineAST.TransformNode["kind"]>().toEqualTypeOf<"transform:object">();
    });

    it("types update paths as string/number segments", () => {
      expectTypeOf<PipelineAST.Path>().toEqualTypeOf<readonly (string | number)[]>();
    });
  });

  describe("data-first nodes stay serializable", () => {
    it("query nodes built by the public builder are plain JSON data", () => {
      let condition: PipelineAST.QueryConditionNode | undefined;

      JIT.query(Users).filter((c) => {
        condition = c.or(c.eq("role", "admin"), c.neq("name", ""));
        return condition;
      });

      expect(JSON.parse(JSON.stringify(condition))).toEqual(condition);
    });
  });
});
