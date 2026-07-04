import { Equal } from "../index.js";

describe("shared equality fallbacks", () => {
  describe("deepEquals", () => {
    it("compares primitives with SameValue semantics", () => {
      expect(Equal.deepEquals(1, 1)).toBe(true);
      expect(Equal.deepEquals("a", "a")).toBe(true);
      expect(Equal.deepEquals(Number.NaN, Number.NaN)).toBe(true);
      expect(Equal.deepEquals(1, 2)).toBe(false);
      expect(Equal.deepEquals<unknown>("1", 1)).toBe(false);
    });

    it("compares nested objects structurally", () => {
      const left = { id: 1, profile: { name: "Ada", tags: ["x", "y"] } };
      const right = { id: 1, profile: { name: "Ada", tags: ["x", "y"] } };

      expect(Equal.deepEquals(left, right)).toBe(true);
      expect(Equal.deepEquals(left, { ...right, id: 2 })).toBe(false);
      expect(Equal.deepEquals(left, { ...right, profile: { name: "Ada", tags: ["x", "z"] } })).toBe(false);
    });

    it("distinguishes arrays from objects and checks lengths first", () => {
      expect(Equal.deepEquals<unknown>([1, 2], { 0: 1, 1: 2 })).toBe(false);
      expect(Equal.deepEquals<unknown>({ 0: 1 }, [1])).toBe(false);
      expect(Equal.deepEquals([1, 2], [1, 2, 3])).toBe(false);
      expect(Equal.deepEquals([], [])).toBe(true);
    });

    it("requires the same key set on both sides", () => {
      expect(Equal.deepEquals<Record<string, unknown>>({ a: 1 }, { a: 1, b: undefined })).toBe(false);
      expect(Equal.deepEquals<Record<string, unknown>>({ a: undefined }, { b: undefined })).toBe(false);
    });

    it("treats null and undefined as distinct", () => {
      expect(Equal.deepEquals<unknown>(null, undefined)).toBe(false);
      expect(Equal.deepEquals(null, null)).toBe(true);
      expect(Equal.deepEquals(undefined, undefined)).toBe(true);
    });
  });

  describe("laxEquals", () => {
    it("ignores keys whose value is undefined", () => {
      expect(Equal.lax<Record<string, unknown>>({ a: 1 }, { a: 1, b: undefined })).toBe(true);
      expect(Equal.lax<Record<string, unknown>>({ a: 1, c: undefined }, { a: 1 })).toBe(true);
      expect(Equal.lax<Record<string, unknown>>({ a: 1 }, { a: 2 })).toBe(false);
    });

    it("still compares arrays strictly", () => {
      expect(Equal.lax([1, 2], [1, 2])).toBe(true);
      expect(Equal.lax([1, 2], [2, 1])).toBe(false);
    });
  });

  describe("combinators", () => {
    it("SameType groups values by typeof family", () => {
      expect(Equal.SameType(1, 2)).toBe(true);
      expect(Equal.SameType("a", "b")).toBe(true);
      expect(Equal.SameType(null, {})).toBe(true);
      expect(Equal.SameType(1, "1")).toBe(false);
      expect(Equal.SameType(undefined, undefined)).toBe(true);
    });

    it("SameNumber follows Object.is for zeros and NaN", () => {
      expect(Equal.SameNumber(0, 0)).toBe(true);
      expect(Equal.SameNumber(0, -0)).toBe(false);
      expect(Equal.SameNumber(Number.NaN, Number.NaN)).toBe(true);
      expect(Equal.SameNumber(1, 1)).toBe(true);
      expect(Equal.SameNumber(1, 2)).toBe(false);
    });

    it("SameValue is Object.is", () => {
      expect(Equal.SameValue).toBe(Object.is);
    });

    it("IsStrictEqual is ===", () => {
      expect(Equal.IsStrictEqual(1, 1)).toBe(true);
      expect(Equal.IsStrictEqual(Number.NaN, Number.NaN)).toBe(false);
    });
  });

  describe("aliases", () => {
    it("exposes deep and deepEqual as aliases of deepEquals", () => {
      expect(Equal.deep).toBe(Equal.deepEquals);
      expect(Equal.deepEqual).toBe(Equal.deepEquals);
    });
  });
});
