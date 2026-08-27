import { serializeCallback } from "../serialize-callback.js";

describe("AOT callback reconstruction", () => {
  it("accepts standalone arrows and stable globals", () => {
    expect(serializeCallback((value: number) => Math.max(value, 0))).toContain("Math.max");
  });

  it("normalizes object methods into standalone functions", () => {
    const holder = {
      double(value: number) {
        return value * 2;
      },
    };

    const source = serializeCallback(holder.double);

    expect(source).toMatch(/^\(function double\(value\)/);
    expect(source).toContain("return value * 2");
  });

  it("rejects lexical closure dependencies", () => {
    const offset = 1;

    expect(serializeCallback((value: number) => value + offset)).toBeUndefined();
  });

  it("does not mistake identifiers inside literals, comments, or regexes for closures", () => {
    const callback = (value: string) => {
      // hiddenIdentifier is not executable.
      return /externalName/.test(value) ? `${value}:templateText` : "literalName";
    };

    expect(serializeCallback(callback)).toBeDefined();
  });

  it("rejects native, bound, and this-dependent functions", () => {
    expect(serializeCallback(Math.max)).toBeUndefined();
    expect(serializeCallback(((value: number) => value).bind(undefined))).toBeUndefined();
    expect(
      serializeCallback(function (this: unknown) {
        return this;
      })
    ).toBeUndefined();
  });
});
