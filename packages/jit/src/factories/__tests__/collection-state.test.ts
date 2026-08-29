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

  it.each(strategies)("replaces one row by key on the %s path", (_label, schema) => {
    const replace = JIT.state.collection(schema).replaceByKey({ key: "id" });
    const replacement = { id: "b", name: "Bee", score: 9 };

    expect(replace(rows, { key: "missing", row: replacement })).toBe(rows);
    expect(replace(rows, { key: "b", row: { id: "b", name: "Bob", score: 2 } })).toBe(rows);
    const next = replace(rows, { key: "b", row: replacement });
    expect(next).toEqual([rows[0], replacement, rows[2]]);
    expect(next[0]).toBe(rows[0]);
    expect(next[2]).toBe(rows[2]);
    expect(sourceOf(replace)).toContain("__equal(row, next)");
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

  it("performs positional insertion and removal with one exact-sized result", () => {
    const Items = JIT.state.collection(JIT.array(JIT.number()));
    const insert = Items.insertAt();
    const remove = Items.removeAt();
    const value = [1, 2, 3] as const;

    expect(insert(value, { index: 0, row: 0 })).toEqual([0, 1, 2, 3]);
    expect(insert(value, { index: 2, row: 9 })).toEqual([1, 2, 9, 3]);
    expect(insert(value, { index: 3, row: 4 })).toEqual([1, 2, 3, 4]);
    expect(remove(value, { index: 0 })).toEqual([2, 3]);
    expect(remove(value, { index: 1 })).toEqual([1, 3]);
    expect(remove(value, { index: 2 })).toEqual([1, 2]);

    for (const index of [-1, 4, 1.5, Number.NaN]) {
      expect(insert(value, { index, row: 9 })).toBe(value);
      expect(remove(value, { index })).toBe(value);
    }
    expect(sourceOf(insert)).toContain("new Array(len + 1)");
    expect(sourceOf(remove)).toContain("new Array(len - 1)");
    expect(sourceOf(insert)).not.toMatch(/\.slice\(|\.splice\(|\.concat\(/);
    expect(sourceOf(remove)).not.toMatch(/\.slice\(|\.splice\(|\.filter\(/);
  });

  it("replaces by position with schema equality and retains no-op references", () => {
    const Values = JIT.state.collection(JIT.array(User));
    const replace = Values.replaceAt();
    const equal = { id: "b", name: "Bob", score: 2 };
    const replacement = { id: "b", name: "Bee", score: 2 };

    expect(replace(rows, { index: 1, row: equal })).toBe(rows);
    const next = replace(rows, { index: 1, row: replacement });
    expect(next).toEqual([rows[0], replacement, rows[2]]);
    expect(next[0]).toBe(rows[0]);
    expect(next[2]).toBe(rows[2]);
    expect(replace(rows, { index: 3, row: replacement })).toBe(rows);
    expect(sourceOf(replace)).toContain("__equal(row, next)");
  });

  it("updates one element through its shared MutationPlan", () => {
    const update = JIT.state.collection(Plain).updateAt({
      patch: { name: JIT.cqrs.param("name") },
    });

    expect(update(rows, { index: 1, name: "Bob" })).toBe(rows);
    expect(update(rows, { index: -1, name: "Bee" })).toBe(rows);
    const next = update(rows, { index: 1, name: "Bee" });
    expect(next[0]).toBe(rows[0]);
    expect(next[1]).toEqual({ id: "b", name: "Bee", score: 2 });
    expect(next[2]).toBe(rows[2]);
    expect(sourceOf(update).indexOf("if (next === row) return value;")).toBeLessThan(
      sourceOf(update).indexOf("value.slice()")
    );
  });

  it("swaps and moves slots without intermediate collection operations", () => {
    const Items = JIT.state.collection(JIT.array(JIT.number()));
    const swap = Items.swap();
    const move = Items.move();
    const value = [0, 1, 2, 3] as const;

    expect(swap(value, { a: 0, b: 3 })).toEqual([3, 1, 2, 0]);
    expect(swap(value, { a: 2, b: 2 })).toBe(value);
    expect(swap(value, { a: -1, b: 2 })).toBe(value);
    expect(move(value, { from: 0, to: 3 })).toEqual([1, 2, 3, 0]);
    expect(move(value, { from: 3, to: 1 })).toEqual([0, 3, 1, 2]);
    expect(move(value, { from: 1, to: 1 })).toBe(value);
    expect(move(value, { from: 4, to: 0 })).toBe(value);
    expect(sourceOf(move)).not.toMatch(/\.splice\(|\.slice\(|\.copyWithin\(/);
  });

  it("truncates only to a shorter valid length", () => {
    const truncate = JIT.state.collection(JIT.array(JIT.number())).truncate();
    const value = [1, 2, 3] as const;

    expect(truncate(value, { length: 0 })).toEqual([]);
    expect(truncate(value, { length: 2 })).toEqual([1, 2]);
    expect(truncate(value, { length: 3 })).toBe(value);
    expect(truncate(value, { length: 9 })).toBe(value);
    expect(truncate(value, { length: -1 })).toBe(value);
    expect(truncate(value, { length: 1.5 })).toBe(value);
    expect(sourceOf(truncate)).toContain("new Array(length)");
  });

  it("reports positional intent separately from key access planning", () => {
    const insert = JIT.state.collection(Keyed).insertAt();
    const update = JIT.state.collection(Keyed).updateAt({ patch: { name: "Ada" } });

    expect(insert.explain().physical.strategy).toBe("DirectPosition");
    expect(insert.explain().mutation).toMatchObject({
      changesLength: true,
      changesOrder: true,
      preservesKeyed: false,
      preservesOrdering: false,
    });
    expect(update.explain().mutation).toMatchObject({
      changesLength: false,
      changesOrder: false,
      preservesKeyed: true,
      preservesOrdering: true,
      writes: [["name"]],
    });
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

  it("can stop removeWhere after its first match", () => {
    const value = [
      { id: "a", name: "same", score: 1 },
      { id: "b", name: "same", score: 2 },
      { id: "c", name: "other", score: 3 },
    ];
    const removeFirst = JIT.state.collection(Plain).removeWhere((query) => query.eq("name", "same"), { mode: "first" });

    expect(removeFirst(value, {})).toEqual([value[1], value[2]]);
    expect(sourceOf(removeFirst)).toContain("break;");
    expect(sourceOf(removeFirst)).not.toContain("removed++");
  });

  it("replaces predicate matches through the shared condition and access path", () => {
    const replacement = { id: "b", name: "Bee", score: 9 };
    const replaceAll = JIT.state.collection(Plain).replaceWhere((query) => query.gte("score", JIT.cqrs.param("score")));
    const replaceKey = JIT.state.collection(Keyed).replaceWhere((query) => query.eq("id", JIT.cqrs.param("id")));

    const next = replaceAll(rows, { score: 2, row: replacement });
    expect(next).toEqual([rows[0], replacement, replacement]);
    expect(next[0]).toBe(rows[0]);
    expect(replaceAll(rows, { score: 9, row: replacement })).toBe(rows);
    expect(replaceKey.explain().physical.strategy).toBe("CachedIndexLookup");
    expect(replaceKey(rows, { id: "b", row: { id: "b", name: "Bob", score: 2 } })).toBe(rows);
    expect(replaceKey(rows, { id: "missing", row: replacement })).toBe(rows);
    expect(sourceOf(replaceAll)).not.toMatch(/\.map\(|\.filter\(/);
  });

  it("refuses a patch that would invalidate the facts the search rests on", () => {
    expect(() => JIT.state.collection(Keyed).updateByKey({ key: "id", patch: { id: JIT.cqrs.param("id") } })).toThrow(
      /identity key/i
    );
    expect(() => JIT.state.collection(Plain).removeByKey()).toThrow(/needs a key/i);
    // @ts-expect-error a collection mutation needs an array schema
    expect(() => JIT.state.collection(User)).toThrow(/array schema/i);
  });

  describe("ordered repositioning", () => {
    const OrderedByScore = JIT.array(User).keyed("id").ordered("score");
    const reorder = JIT.state
      .collection(OrderedByScore)
      .updateByKey({ key: "id", patch: { score: JIT.cqrs.param("score") } });
    const ranked = [
      { id: "a", name: "A", score: 1 },
      { id: "b", name: "B", score: 2 },
      { id: "c", name: "C", score: 3 },
      { id: "d", name: "D", score: 4 },
    ];
    const order = (rows: readonly (typeof ranked)[number][]) => rows.map((row) => row.id).join("");

    it("moves the row rather than leaving a collection that lies about its order", () => {
      // The old behavior refused this patch. Writing the ordering key does not
      // invalidate the fact — it relocates the row — so the mutation repairs it.
      expect(order(reorder(ranked, { key: "b", score: 9 }))).toBe("acdb");
      expect(order(reorder(ranked, { key: "d", score: 0 }))).toBe("dabc");
      expect(order(reorder(ranked, { key: "a", score: 3.5 }))).toBe("bcad");
      // A new key that lands in the same slot keeps the one-slot replacement.
      expect(order(reorder(ranked, { key: "b", score: 2.5 }))).toBe("abcd");
      expect(reorder(ranked, { key: "b", score: 2.5 })[1]?.score).toBe(2.5);
    });

    it("keeps the collection sorted for every destination", () => {
      for (const target of ["a", "b", "c", "d"]) {
        for (const score of [-1, 0.5, 1.5, 2.5, 3.5, 10]) {
          const next = reorder(ranked, { key: target, score });
          expect(next).toHaveLength(ranked.length);
          expect(next.map((row) => row.score)).toEqual([...next.map((row) => row.score)].sort((a, b) => a - b));
          expect(next.find((row) => row.id === target)?.score).toBe(score);
        }
      }
    });

    it("searches the array it is about to produce, and reports the move", () => {
      expect(reorder.explain().mutation.changesOrder).toBe(true);
      expect(reorder.explain().mutation.preservesOrdering).toBe(true);
      expect(sourceOf(reorder)).not.toContain(".sort(");
      expect(sourceOf(reorder)).toContain("value[mid < at ? mid : mid + 1]");
      // Nothing changed and nothing found still return the original array.
      expect(reorder(ranked, { key: "b", score: 2 })).toBe(ranked);
      expect(reorder(ranked, { key: "missing", score: 9 })).toBe(ranked);
    });

    it("follows a descending ordering fact", () => {
      const descending = JIT.array(User).keyed("id").ordered("score", "desc");
      const move = JIT.state
        .collection(descending)
        .updateByKey({ key: "id", patch: { score: JIT.cqrs.param("score") } });
      const rows = [...ranked].reverse();

      expect(order(move(rows, { key: "c", score: 0 }))).toBe("dbac");
      expect(move(rows, { key: "c", score: 0 }).map((row) => row.score)).toEqual([4, 2, 1, 0]);
    });
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

  it("agrees with positional reference implementations", () => {
    const Items = JIT.state.collection(JIT.array(JIT.number()));
    const insert = Items.insertAt();
    const remove = Items.removeAt();
    const move = Items.move();

    fc.assert(
      fc.property(
        fc.array(fc.integer(), { maxLength: 40 }),
        fc.integer(),
        fc.integer(),
        fc.integer(),
        (value, a, b, item) => {
          const expectedInsert =
            Number.isInteger(a) && a >= 0 && a <= value.length
              ? [...value.slice(0, a), item, ...value.slice(a)]
              : value;
          const expectedRemove =
            Number.isInteger(a) && a >= 0 && a < value.length ? [...value.slice(0, a), ...value.slice(a + 1)] : value;
          let expectedMove: readonly number[] = value;
          if (
            Number.isInteger(a) &&
            Number.isInteger(b) &&
            a >= 0 &&
            b >= 0 &&
            a < value.length &&
            b < value.length &&
            a !== b
          ) {
            const copy = [...value];
            const [moved] = copy.splice(a, 1);
            copy.splice(b, 0, moved as number);
            expectedMove = copy;
          }

          expect(insert(value, { index: a, row: item })).toEqual(expectedInsert);
          expect(remove(value, { index: a })).toEqual(expectedRemove);
          expect(move(value, { from: a, to: b })).toEqual(expectedMove);
        }
      ),
      { numRuns: 200 }
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
