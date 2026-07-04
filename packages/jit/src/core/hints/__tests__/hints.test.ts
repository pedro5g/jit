import { AST, JIT } from "../../../index.js";
import { mergeHints } from "../hint-merge.js";
import { resolveHints } from "../hint-resolver.js";

describe("core hints", () => {
  const User = JIT.object({
    id: JIT.number(),
    name: JIT.string(),
  });

  describe("resolveHints", () => {
    it("returns an empty bag for schemas without hints", () => {
      expect(resolveHints(User.schema)).toEqual({});
    });

    it("collects hints attached through builder methods", () => {
      const Users = JIT.array(User).entity({ key: "id" }).indexBy("id");
      const hints = resolveHints(Users.schema);

      expect(hints.entity?.key).toBe("id");
      expect(hints.index?.key).toBe("id");
      expect(hints.collection?.indexed).toBe(true);
      expect(hints.collection?.identify).toBe("id");
    });

    it("resolves hints through wrapper schemas", () => {
      const Wrapped = JIT.array(User).indexBy("id").optional();
      const hints = resolveHints(Wrapped.schema);

      expect(hints.index?.key).toBe("id");
    });

    it("does not mutate the schema when resolving", () => {
      const Users = JIT.array(User).ordered("id", "asc");
      const before = JSON.stringify(Users.schema.annotations);

      resolveHints(Users.schema);

      expect(JSON.stringify(Users.schema.annotations)).toBe(before);
      expect(Users.schema.type).toBe(AST.TypeName.array);
    });

    it("backfills the order key from collection.identify", () => {
      const Users = JIT.array(User).ordered("id");
      const hints = resolveHints(Users.schema);

      expect(hints.order?.key).toBe("id");
    });
  });

  describe("mergeHints", () => {
    it("returns the other side when one side is missing", () => {
      const only = { entity: { type: "entity", key: "id" } } as const;

      expect(mergeHints(only, undefined)).toBe(only);
      expect(mergeHints(undefined, only)).toBe(only);
      expect(mergeHints(undefined, undefined)).toEqual({});
    });

    it("prefers the right-hand side for scalar hint slots", () => {
      const left = { entity: { type: "entity", key: "left" } } as const;
      const right = { entity: { type: "entity", key: "right" } } as const;

      expect(mergeHints(left, right).entity?.key).toBe("right");
    });

    it("merges collection hints field by field", () => {
      const left = { collection: { identify: "id", indexed: true } } as const;
      const right = { collection: { groupBy: "role" } } as const;
      const merged = mergeHints(left, right);

      expect(merged.collection).toMatchObject({
        identify: "id",
        indexed: true,
        groupBy: "role",
      });
    });

    it("omits empty slots instead of storing undefined", () => {
      const merged = mergeHints({ entity: { type: "entity", key: "id" } }, {});

      expect(Object.keys(merged)).toEqual(["entity"]);
      expect("index" in merged).toBe(false);
    });
  });

  describe("builder hint accumulation", () => {
    it("later hints win over earlier hints in a chain", () => {
      const Users = JIT.array(User).indexBy("id").indexBy("name");
      const hints = resolveHints(Users.schema);

      expect(hints.index?.key).toBe("name");
      expect(hints.collection?.identify).toBe("name");
    });
  });
});
