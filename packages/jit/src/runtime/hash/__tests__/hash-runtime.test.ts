import { combineHash, getHash, hashNumber, hashString } from "../index.js";

describe("hash runtime", () => {
  it("should hash primitive values deterministically", () => {
    expect(hashNumber(42)).toBe(42);
    expect(hashString("Ada")).toBe(hashString("Ada"));
    expect(hashString("Ada")).not.toBe(hashString("Grace"));
    expect(combineHash(17, hashString("Ada"))).toBe(combineHash(17, hashString("Ada")));
  });

  it("should cache object hashes by reference", () => {
    const value = { id: 1 };
    let calls = 0;

    const compute = () => {
      calls++;
      return 123;
    };

    expect(getHash(value, compute)).toBe(123);
    expect(getHash(value, compute)).toBe(123);
    expect(calls).toBe(1);
  });
});
