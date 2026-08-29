import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { JIT } from "../../index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";

const User = JIT.object({ id: JIT.string(), name: JIT.string(), score: JIT.number() });
const Keyed = JIT.array(User).keyed("id");
const Ordered = JIT.array(User).ordered("id").uniqueBy("id");
const Plain = JIT.array(User);

const rows = [
  { id: "a", name: "Ada", score: 1 },
  { id: "b", name: "Bob", score: 2 },
  { id: "c", name: "Cy", score: 3 },
];

const strategies = [
  ["keyed", Keyed, "CachedIndexLookup"],
  ["ordered", Ordered, "BinarySearch"],
  ["plain", Plain, "EarlyExitScan"],
] as const;

function sourceOf(mutate: unknown): string {
  const artifact = getArtifact(mutate as object);
  if (artifact?.kind !== "collection-mutation-plan") throw new Error("expected a collection mutation artifact");
  return artifact.source;
}

describe("JIT.state.collection", () => {
  it.each(strategies)("reaches a row by %s facts", (_label, schema, strategy) => {
    const update = JIT.state.collection(schema).updateByKey({ key: "id", patch: { name: JIT.cqrs.param("name") } });

    expect(update.explain().physical.strategy).toBe(strategy);
    expect(update.explain().operation).toBe("updateByKey");
    // Finding a row can be sublinear; rebuilding an immutable array cannot.
    expect(update.explain().copy).toBe("O(n)");
  });

  it.each(strategies)("updates one row by key on the %s path", (_label, schema) => {
    const update = JIT.state.collection(schema).updateByKey({ key: "id", patch: { name: JIT.cqrs.param("name") } });

    for (const [index, id] of ["a", "b", "c"].entries()) {
      const next = update(rows, { key: id, name: "changed" });
      expect(next[index]?.name).toBe("changed");
      expect(next).toHaveLength(3);
      // Only the matched row is replaced.
      for (const other of [0, 1, 2].filter((position) => position !== index)) {
        expect(next[other]).toBe(rows[other]);
      }
    }
    // Nothing changed, and a missing key changes nothing: the original array.
    expect(update(rows, { key: "b", name: "Bob" })).toBe(rows);
    expect(update(rows, { key: "missing", name: "x" })).toBe(rows);
  });

  it.each(strategies)("removes one row by key on the %s path", (_label, schema) => {
    const remove = JIT.state.collection(schema).removeByKey({ key: "id" });

    expect(remove(rows, { key: "a" })).toEqual([rows[1], rows[2]]);
    expect(remove(rows, { key: "b" })).toEqual([rows[0], rows[2]]);
    expect(remove(rows, { key: "c" })).toEqual([rows[0], rows[1]]);
    expect(remove(rows, { key: "missing" })).toBe(rows);
    expect(remove([rows[0] as (typeof rows)[number]], { key: "a" })).toEqual([]);
    // Not `filter`: the position is found first, then one array is filled.
    expect(sourceOf(remove)).not.toContain(".filter(");
    expect(sourceOf(remove)).toContain("new Array(len - 1)");
  });

  it("upserts through the access path and keeps an ordered collection ordered", () => {
    const keyed = JIT.state.collection(Keyed).upsert({ key: "id" });
    const ordered = JIT.state.collection(Ordered).upsert({ key: "id" });
    const inserted = { id: "bb", name: "New", score: 9 };

    expect(keyed(rows, { key: "b", row: { id: "b", name: "Bee", score: 9 } })[1]).toEqual({
      id: "b",
      name: "Bee",
      score: 9,
    });
    // A structurally equal row is not a change.
    expect(keyed(rows, { key: "b", row: { id: "b", name: "Bob", score: 2 } })).toBe(rows);
    // An index knows nothing about order, so a miss appends.
    expect(keyed(rows, { key: "bb", row: inserted })).toEqual([...rows, inserted]);
    // A binary search reports where the key belongs, so the order survives.
    expect(ordered(rows, { key: "bb", row: inserted })).toEqual([rows[0], rows[1], inserted, rows[2]]);
    expect(ordered(rows, { key: "z", row: { id: "z", name: "Z", score: 0 } })).toHaveLength(4);
  });

  it("inserts at either end without reaching a row", () => {
    const append = JIT.state.collection(Keyed).append();
    const prepend = JIT.state.collection(Keyed).prepend();
    const row = { id: "d", name: "Dee", score: 4 };

    expect(append(rows, { row })).toEqual([...rows, row]);
    expect(prepend(rows, { row })).toEqual([row, ...rows]);
    expect(append([], { row })).toEqual([row]);
    expect(sourceOf(append)).not.toContain("find(");
  });

  it("selects rows by the shared query condition", () => {
    const Wide = JIT.object({ id: JIT.string(), name: JIT.string(), score: JIT.number(), active: JIT.boolean() });
    const Members = JIT.array(Wide).keyed("id");
    const members = [
      { id: "a", name: "Ada", score: 1, active: true },
      { id: "b", name: "Bob", score: 2, active: false },
      { id: "c", name: "Cy", score: 3, active: false },
    ];
    const rename = JIT.state
      .collection(Members)
      .updateWhere((query) => query.eq("active", false), { name: JIT.cqrs.param("name") });
    const drop = JIT.state.collection(Members).removeWhere((query) => query.gte("score", 2));

    // A predicate that can match several rows visits every row.
    expect(rename.explain().physical.strategy).toBe("EarlyExitScan");
    expect(rename(members, { name: "x" }).map((row) => row.name)).toEqual(["Ada", "x", "x"]);
    expect(rename(members, { name: "x" })[0]).toBe(members[0]);
    expect(drop(members, {})).toEqual([members[0]]);
    // Nothing matched, or nothing changed: the original collection.
    expect(rename(members, { name: undefined })).toBe(members);
    expect(JIT.state.collection(Members).removeWhere((query) => query.eq("id", "absent"))(members, {})).toBe(members);
  });

  it("lifts a unique equality predicate onto the declared access path", () => {
    const byKey = JIT.state
      .collection(Keyed)
      .updateWhere((query) => query.eq("id", JIT.cqrs.param("id")), { name: JIT.cqrs.param("name") });
    const removeByKey = JIT.state.collection(Ordered).removeWhere((query) => query.eq("id", JIT.cqrs.param("id")));

    expect(byKey.explain().physical.strategy).toBe("CachedIndexLookup");
    expect(removeByKey.explain().physical.strategy).toBe("BinarySearch");
    expect(byKey(rows, { id: "b", name: "Bee" })[1]?.name).toBe("Bee");
    expect(byKey(rows, { id: "absent", name: "Bee" })).toBe(rows);
    expect(removeByKey(rows, { id: "b" })).toEqual([rows[0], rows[2]]);
    // The predicate matches at most one row, so the row is reached rather
    // than searched for; the only loop left is the index build itself.
    expect(sourceOf(byKey)).toContain("const at = find(value, params);");
    expect(sourceOf(removeByKey)).not.toContain("removed");
  });

  it("allocates the removal array once and only when something matches", () => {
    const drop = JIT.state.collection(Plain).removeWhere((query) => query.eq("name", JIT.cqrs.param("name")));
    const source = sourceOf(drop);

    expect(source).not.toContain(".filter(");
    expect(source).toContain("if (removed === 0) return value;");
    expect(source).toContain("new Array(len - removed)");
    expect(drop(rows, { name: "Ada" })).toEqual([rows[1], rows[2]]);
    expect(drop(rows, { name: "absent" })).toBe(rows);
  });

  it("refuses a patch that would invalidate the facts the search rests on", () => {
    expect(() => JIT.state.collection(Keyed).updateByKey({ key: "id", patch: { id: JIT.cqrs.param("id") } })).toThrow(
      /identity key/i
    );
    const OrderedByScore = JIT.array(User).keyed("id").ordered("score");
    expect(() =>
      JIT.state.collection(OrderedByScore).updateByKey({ key: "id", patch: { score: JIT.cqrs.param("score") } })
    ).toThrow(/ordering key/i);
    expect(() => JIT.state.collection(Plain).removeByKey()).toThrow(/needs a key/i);
    // @ts-expect-error a collection mutation needs an array schema
    expect(() => JIT.state.collection(User)).toThrow(/array schema/i);
  });

  it("does not discover the shape or scan past the answer", () => {
    const update = JIT.state.collection(Keyed).updateByKey({ key: "id", patch: { name: JIT.cqrs.param("name") } });
    const source = sourceOf(update);

    expect(source).not.toContain("Object.keys");
    expect(source).not.toContain(".map(");
    expect(source).not.toContain(".findIndex(");
    // The array is copied after the decision, never before it.
    expect(source.indexOf("if (next === row) return value;")).toBeLessThan(source.indexOf("value.slice()"));
  });

  it("agrees with a straightforward implementation on every key", () => {
    const update = JIT.state.collection(Keyed).updateByKey({ key: "id", patch: { name: JIT.cqrs.param("name") } });
    const remove = JIT.state.collection(Keyed).removeByKey({ key: "id" });

    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1, maxLength: 3 }), { maxLength: 40 }), fc.string(), (ids, name) => {
        const unique = [...new Set(ids)];
        const value = unique.map((id, index) => ({ id, name: `n${index}`, score: index }));
        for (const key of [...unique, "absent"]) {
          const expectedUpdate = value.map((row) => (row.id === key && row.name !== name ? { ...row, name } : row));
          const expectedRemove = value.filter((row) => row.id !== key);

          expect(update(value, { key, name })).toEqual(expectedUpdate);
          expect(remove(value, { key })).toEqual(expectedRemove);
        }
      }),
      { numRuns: 150 }
    );
  });

  it.each([0, 1, 8, 64, 1_000])("holds on a collection of %i rows", (size) => {
    const value = Array.from({ length: size }, (_, index) => ({
      id: `u_${index}`,
      name: `n${index}`,
      score: index,
    }));
    const update = JIT.state.collection(Keyed).updateByKey({ key: "id", patch: { name: JIT.cqrs.param("name") } });
    const remove = JIT.state.collection(Keyed).removeByKey({ key: "id" });
    const target = size === 0 ? "u_0" : `u_${Math.floor(size / 2)}`;

    if (size === 0) {
      expect(update(value, { key: target, name: "x" })).toBe(value);
      expect(remove(value, { key: target })).toBe(value);
      return;
    }
    expect(update(value, { key: target, name: "x" })).toHaveLength(size);
    expect(remove(value, { key: target })).toHaveLength(size - 1);
    expect(remove(value, { key: target }).some((row) => row.id === target)).toBe(false);
  });
});
