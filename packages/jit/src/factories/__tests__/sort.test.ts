import { emitSortSource } from "../../compiler/sort.js";
import { JIT } from "../../index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";

describe("JIT.sort", () => {
  const User = JIT.object({
    id: JIT.number(),
    lastName: JIT.string(),
    createdAt: JIT.date(),
  });

  it("compiles a non-mutating multi-field SortPlan with one shared comparator", () => {
    const sortUsers = JIT.sort(User).by("lastName").thenBy("createdAt", "desc");
    const oldSilva = { id: 1, lastName: "Silva", createdAt: new Date("2024-01-01") };
    const newSilva = { id: 2, lastName: "Silva", createdAt: new Date("2025-01-01") };
    const ada = { id: 3, lastName: "Lovelace", createdAt: new Date("1815-12-10") };
    const input = [oldSilva, ada, newSilva];

    expect(sortUsers(input)).toEqual([ada, newSilva, oldSilva]);
    expect(sortUsers(input)).not.toBe(input);
    expect(input).toEqual([oldSilva, ada, newSilva]);
    expect(sortUsers.compare(newSilva, oldSilva)).toBeLessThan(0);
    const artifact = getArtifact(sortUsers);
    expect(artifact?.kind).toBe("sort-plan");
    expect(artifact?.kind === "sort-plan" ? artifact.descriptor.criteria : undefined).toEqual([
      { key: "lastName", direction: "asc", valueKind: "direct", nullish: false },
      { key: "createdAt", direction: "desc", valueKind: "date", nullish: false },
    ]);
    expectTypeOf(sortUsers(input)).toEqualTypeOf<(typeof input)[number][]>();
  });

  it("mutates only through the explicit inPlace operation", () => {
    const byId = JIT.sort(User).by("id", "desc");
    const input = [
      { id: 1, lastName: "A", createdAt: new Date(0) },
      { id: 2, lastName: "B", createdAt: new Date(0) },
    ];

    expect(byId.inPlace(input)).toBe(input);
    expect(input.map((value) => value.id)).toEqual([2, 1]);
  });

  it("keeps a total order across absent values and falls through to the next criterion", () => {
    const Row = JIT.object({ rank: JIT.number().nullable().optional(), id: JIT.number() });
    const byRank = JIT.sort(Row).by("rank").thenBy("id");
    const nulled = { rank: null, id: 1 };
    const missing = { rank: undefined, id: 2 };

    // `null` and `undefined` are both absent: neither may win over the other.
    expect(byRank.compare(nulled, missing)).toBe(-byRank.compare(missing, nulled));
    expect(byRank([missing, nulled]).map((row) => row.id)).toEqual([1, 2]);
    // Ascending puts absent values first; descending puts them last.
    expect(byRank([{ rank: 5, id: 9 }, nulled, { rank: 1, id: 8 }]).map((row) => row.rank)).toEqual([null, 1, 5]);

    const Dated = JIT.object({ at: JIT.date().optional(), id: JIT.number() });
    const byAt = JIT.sort(Dated).by("at", "desc");

    expect(
      byAt([
        { at: undefined, id: 1 },
        { at: new Date(1_000), id: 2 },
        { at: new Date(5_000), id: 3 },
      ]).map((row) => row.id)
    ).toEqual([3, 2, 1]);
  });

  it("specializes Date access and rejects unknown, repeated, or structural keys", () => {
    const byDate = JIT.sort(User).by("createdAt");

    const artifact = getArtifact(byDate);
    expect(artifact?.kind).toBe("sort-plan");
    expect(emitSortSource(artifact?.kind === "sort-plan" ? artifact.descriptor : { criteria: [] })).toContain(
      "leftRaw.getTime()"
    );
    expect(() => JIT.sort(User).by("missing" as never)).toThrow(/unknown key/i);
    expect(() => JIT.sort(User).by("id").thenBy("id")).toThrow(/repeats key/i);

    const Nested = JIT.object({ value: JIT.object({ id: JIT.number() }) });
    expect(() => JIT.sort(Nested).by("value")).toThrow(/statically orderable scalar/i);

    const Optional = JIT.object({ rank: JIT.number().optional() });
    const optionalSort = JIT.sort(Optional).by("rank");
    expect(optionalSort([{ rank: 2 }, { rank: undefined }, { rank: 1 }])).toEqual([
      { rank: undefined },
      { rank: 1 },
      { rank: 2 },
    ]);

    const invalidKey = () => {
      // @ts-expect-error sort keys are checked from the schema output.
      return JIT.sort(User).by("missing");
    };
    expectTypeOf(invalidKey).toBeFunction();
  });
});
