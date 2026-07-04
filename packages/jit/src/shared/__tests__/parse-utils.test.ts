import { Parse, Utils } from "../index.js";

describe("Parse source helpers", () => {
  describe("isQuoted", () => {
    it("detects strings wrapped in matching quotes", () => {
      expect(Parse.isQuoted('"name"')).toBe(true);
      expect(Parse.isQuoted("'name'")).toBe(true);
      expect(Parse.isQuoted("`name`")).toBe(true);
    });

    it("rejects unquoted, mismatched, or internally quoted strings", () => {
      expect(Parse.isQuoted("name")).toBe(false);
      expect(Parse.isQuoted("\"name'")).toBe(false);
      expect(Parse.isQuoted('"na"me"')).toBe(false);
      expect(Parse.isQuoted('"')).toBe(false);
      expect(Parse.isQuoted(42)).toBe(false);
    });
  });

  describe("escapeString", () => {
    it("escapes control characters, quotes, backslashes, and backticks", () => {
      expect(Parse.escapeString('say "hi"')).toBe('say \\"hi\\"');
      expect(Parse.escapeString("a\nb\tc")).toBe("a\\nb\\tc");
      expect(Parse.escapeString("back\\slash")).toBe("back\\\\slash");
      expect(Parse.escapeString("tick`")).toBe("tick\\`");
    });

    it("returns the original string when nothing needs escaping", () => {
      const plain = "plain text without specials";

      expect(Parse.escapeString(plain)).toBe(plain);
    });

    it("escapes lone surrogates but keeps valid surrogate pairs", () => {
      expect(Parse.escapeString("😀")).toBe("😀");
      expect(Parse.escapeString("\ud800")).toBe("\\ud800");
    });
  });

  describe("isValidIdentifier", () => {
    it("accepts valid JavaScript identifiers", () => {
      expect(Parse.isValidIdentifier("name")).toBe(true);
      expect(Parse.isValidIdentifier("$ref")).toBe(true);
      expect(Parse.isValidIdentifier("_private")).toBe(true);
      expect(Parse.isValidIdentifier("café")).toBe(true);
    });

    it("rejects names that would need bracket access", () => {
      expect(Parse.isValidIdentifier("1st")).toBe(false);
      expect(Parse.isValidIdentifier("has space")).toBe(false);
      expect(Parse.isValidIdentifier("dash-case")).toBe(false);
      expect(Parse.isValidIdentifier("")).toBe(false);
    });
  });

  describe("parseKey", () => {
    it("keeps identifier-safe keys bare and quotes the rest", () => {
      expect(Parse.parseKey("name")).toBe("name");
      expect(Parse.parseKey("has space")).toBe('"has space"');
    });

    it("always quotes when parseAsJson is set", () => {
      expect(Parse.parseKey("name", { parseAsJson: true })).toBe('"name"');
    });

    it("escapes malicious keys so they cannot break out of generated source", () => {
      expect(Parse.parseKey('a"; process.exit(1); "', { parseAsJson: true })).toBe('"a\\"; process.exit(1); \\""');
    });
  });

  describe("key_access", () => {
    it("emits dot access for identifiers and bracket access otherwise", () => {
      expect(Parse.key_access("name", false)).toBe(".name");
      expect(Parse.key_access("has space", false)).toBe('["has space"]');
      expect(Parse.key_access("name", true)).toBe("?.name");
    });

    it("returns an empty string for non-string keys", () => {
      expect(Parse.key_access(undefined, false)).toBe("");
      expect(Parse.key_access(Symbol("s"), false)).toBe("");
    });
  });

  describe("join_path", () => {
    it("joins mixed string/number paths into an access expression", () => {
      expect(Parse.join_path(["root", "items", 0, "name"], false)).toBe("root.items[0].name");
      expect(Parse.join_path(["root", "has space"], false)).toBe('root["has space"]');
    });
  });

  describe("createIdentifier / ident", () => {
    it("normalizes arbitrary text into a valid identifier", () => {
      expect(Parse.createIdentifier("my-binding")).toBe("my_binding");
      expect(Parse.createIdentifier("1abc")).toBe("_abc");
      expect(Parse.createIdentifier("")).toBe("_");
    });

    it("allocates unique identifiers within a binding map", () => {
      const bindings = new Map<string, string>();

      expect(Parse.ident("value", bindings)).toBe("value");
      expect(Parse.ident("value", bindings)).toBe("value1");
      expect(Parse.ident("value", bindings)).toBe("value2");
      expect(bindings.get("value1")).toBe("value");
    });

    it("does not register the binding when dontBind is passed", () => {
      const bindings = new Map<string, string>();

      expect(Parse.ident("temp", bindings, "dontBind")).toBe("temp");
      expect(bindings.size).toBe(0);
    });
  });
});

describe("Utils", () => {
  it("Object_hasOwn only reports own properties", () => {
    const child = Object.create({ inherited: 1 }) as Record<string, unknown>;
    child.own = 2;

    expect(Utils.Object_hasOwn(child, "own")).toBe(true);
    expect(Utils.Object_hasOwn(child, "inherited")).toBe(false);
    expect(Utils.Object_hasOwn(null, "x")).toBe(false);
    expect(Utils.Object_hasOwn(42, "x")).toBe(false);
  });

  it("Is_Array narrows arrays only", () => {
    expect(Utils.Is_Array([1, 2])).toBe(true);
    expect(Utils.Is_Array("no")).toBe(false);
    expect(Utils.Is_Array({ length: 2 })).toBe(false);
  });
});
