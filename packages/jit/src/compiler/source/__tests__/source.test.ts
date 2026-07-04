import { emitIndexAccess, emitPropertyAccess } from "../access.js";
import { emitLiteral } from "../literal.js";
import { emitPath } from "../path.js";

describe("compiler source emitters", () => {
  describe("emitPropertyAccess", () => {
    it("uses dot access for identifier-safe keys", () => {
      expect(emitPropertyAccess("value", "name")).toBe("value.name");
    });

    it("falls back to quoted bracket access for unsafe keys", () => {
      expect(emitPropertyAccess("value", "has space")).toBe('value["has space"]');
      expect(emitPropertyAccess("value", "kebab-case")).toBe('value["kebab-case"]');
    });

    it("escapes keys that would otherwise break out of the generated source", () => {
      expect(emitPropertyAccess("value", 'a"]; hack(); ["b')).toBe('value["a\\"]; hack(); [\\"b"]');
    });
  });

  describe("emitIndexAccess", () => {
    it("emits bracket access with the raw index expression", () => {
      expect(emitIndexAccess("items", "i")).toBe("items[i]");
      expect(emitIndexAccess("items", "0")).toBe("items[0]");
    });
  });

  describe("emitPath", () => {
    it("chains property accesses from a root binding", () => {
      expect(emitPath("value", ["profile", "address", "city"])).toBe("value.profile.address.city");
    });

    it("handles unsafe segments with bracket access", () => {
      expect(emitPath("value", ["profile", "zip code"])).toBe('value.profile["zip code"]');
    });

    it("returns the root unchanged for an empty path", () => {
      expect(emitPath("value", [])).toBe("value");
    });
  });

  describe("emitLiteral", () => {
    it("emits JSON-quoted strings", () => {
      expect(emitLiteral("text")).toBe('"text"');
      expect(emitLiteral('say "hi"')).toBe('"say \\"hi\\""');
    });

    it("emits bigints with the n suffix", () => {
      expect(emitLiteral(10n)).toBe("10n");
    });

    it("emits primitives with String()", () => {
      expect(emitLiteral(42)).toBe("42");
      expect(emitLiteral(true)).toBe("true");
      expect(emitLiteral(null)).toBe("null");
      expect(emitLiteral(undefined)).toBe("undefined");
    });
  });
});
