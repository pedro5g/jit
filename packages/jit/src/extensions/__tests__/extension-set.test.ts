import { createExtensionSet } from "../extension-set.js";
import { plugin } from "../plugin.js";

describe("extension set", () => {
  const grammar = Object.freeze({ requires: Object.freeze(["string"]), repeat: "forbid" as const });

  it("validates descriptor contracts at installation", () => {
    expect(() =>
      createExtensionSet().add(
        plugin.operator({
          id: "@test/invalid",
          version: "1.0.0",
          abi: 1,
          name: "invalid",
          target: "string",
          grammar: undefined as never,
          compose: (schema: unknown) => schema,
        })
      )
    ).toThrow("extensions require an API grammar");

    expect(() =>
      createExtensionSet().add(
        plugin.semantic({
          id: "@test/invalid-semantic",
          version: "1.0.0",
          abi: 1,
          name: "invalid",
          grammar,
          lower: undefined as never,
        })
      )
    ).toThrow("semantic extensions require a name and lower function");
  });

  it("keeps plugin identity and grammar deterministic", () => {
    const first = plugin.operator({
      id: "@test/slug",
      version: "1.0.0",
      abi: 1,
      name: "slug",
      target: "string",
      grammar,
      compose: (schema: unknown) => schema,
    });
    const second = plugin.operator({
      id: "@test/other",
      version: "1.0.0",
      abi: 1,
      name: "other",
      target: "string",
      grammar,
      compose: (schema: unknown) => schema,
    });
    const left = createExtensionSet([second, first]);
    const right = createExtensionSet([first, second]);

    expect(left.digest).toBe(right.digest);
    expect(left.plugins.map(({ id }) => id)).toEqual(["@test/other", "@test/slug"]);
    expect(left.plugins[0]?.grammar.requires).toEqual(["string"]);
    const requires = left.plugins[0]?.grammar.requires as string[] | undefined;
    expect(() => requires?.push("object")).toThrow();
  });
});
