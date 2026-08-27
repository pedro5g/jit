import { Compiler, JIT } from "../../index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";

const User = JIT.object({ id: JIT.number().int(), name: JIT.string(), score: JIT.number() });
const Users = JIT.array(User).keyed("id");
type User = JIT.Typeof<typeof User>;

const previous: User[] = [
  { id: 1, name: "a", score: 1 },
  { id: 2, name: "b", score: 2 },
  { id: 3, name: "c", score: 3 },
];
const current: User[] = [
  // same values, a different object: unchanged by value, not by reference
  { id: 1, name: "a", score: 1 },
  { id: 2, name: "b!", score: 2 },
  { id: 4, name: "d", score: 4 },
];

function sourceOf(plan: object): string {
  const artifact = getArtifact(plan);

  if (artifact?.kind !== "reconcile-plan") throw new Error("reconcile plan not registered");
  return Compiler.emitReconcileSource(artifact.descriptor);
}

describe("JIT.reconcile", () => {
  it("reports every channel from one pass over each side", () => {
    const result = JIT.reconcile(Users)(previous, current);

    expect(result.added).toEqual([{ id: 4, name: "d", score: 4 }]);
    expect(result.removed).toEqual([{ id: 3, name: "c", score: 3 }]);
    expect(result.changed).toEqual([
      { before: { id: 2, name: "b", score: 2 }, after: { id: 2, name: "b!", score: 2 } },
    ]);
    expect(result.unchanged).toEqual([{ id: 1, name: "a", score: 1 }]);
  });

  /**
   * The distinction that makes reconcile worth compiling: a snapshot rebuilt
   * from the wire has all-new references, and reporting every row as changed
   * would make the result useless.
   */
  it("decides by value, so a rebuilt row with the same fields is unchanged", () => {
    const rebuilt = previous.map((row) => ({ ...row }));
    const result = JIT.reconcile(Users)(previous, rebuilt);

    expect(result.changed).toEqual([]);
    expect(result.unchanged).toHaveLength(3);
  });

  it("takes identity from the collection's fact, and lets .by() name another", () => {
    const byName = JIT.reconcile(JIT.array(User)).by("name");

    expect(JIT.reconcile(Users)(previous, current).added).toHaveLength(1);
    // Keyed by name, row 2 is a removal plus an addition rather than a change.
    expect(byName(previous, current).changed).toEqual([]);
    expect(byName(previous, current).added).toHaveLength(2);
  });

  it("refuses a collection with no identity and no named key", () => {
    // The diagnostic waits for use, so .by() still has a chance to name one.
    expect(() => JIT.reconcile(JIT.array(User))(previous, current)).toThrow(/needs an identity/);
  });

  it("matches a Date identity by timestamp", () => {
    const Session = JIT.object({ at: JIT.date(), user: JIT.string() });
    const Sessions = JIT.array(Session).keyed("at");
    const at = new Date("2026-01-01T00:00:00Z");
    const before = [{ at, user: "ada" }];
    const after = [{ at: new Date("2026-01-01T00:00:00Z"), user: "grace" }];
    const result = JIT.reconcile(Sessions)(before, after);

    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.changed).toHaveLength(1);
  });

  describe("channels", () => {
    it("omits a channel that was turned off", () => {
      const result = JIT.reconcile(Users, { unchanged: false })(previous, current);

      expect(result).not.toHaveProperty("unchanged");
      expect(result.added).toHaveLength(1);
      expect(result.changed).toHaveLength(1);
      expect(result.removed).toHaveLength(1);
    });

    it("does not allocate an array for a channel that was turned off", () => {
      const source = sourceOf(JIT.reconcile(Users, { unchanged: false }));

      expect(source).not.toContain("unchanged");
      expect(source).toContain("const added = []");
    });

    /** Turning a channel off has to remove work, not merely hide a result. */
    it("never compares rows when no channel depends on the comparison", () => {
      const source = sourceOf(JIT.reconcile(Users, { changed: false, unchanged: false }));

      expect(source).not.toContain("__reconcileEqual");
    });

    it("walks the leftover index only when removals were asked for", () => {
      const withRemoved = sourceOf(JIT.reconcile(Users));
      const without = sourceOf(JIT.reconcile(Users, { removed: false }));

      expect(withRemoved).toContain("index.values()");
      expect(without).not.toContain("index.values()");
      // Nothing needs the index to shrink, so nothing deletes from it either.
      expect(without).not.toContain("index.delete");
    });

    it("reads the index once per row when only removals were asked for", () => {
      const source = sourceOf(JIT.reconcile(Users, { added: false, changed: false, unchanged: false }));

      expect(source).toContain("index.delete(item.id);");
      expect(source).not.toContain("index.get");
      expect(source).not.toContain("__reconcileEqual");
    });
  });

  describe("changes('diff')", () => {
    it("attaches a structural diff to each changed pair", () => {
      const result = JIT.reconcile(Users).changes("diff")(previous, current);

      expect(result.changed).toEqual([
        {
          before: { id: 2, name: "b", score: 2 },
          after: { id: 2, name: "b!", score: 2 },
          diff: [{ type: "update", path: ["name"], value: "b!" }],
        },
      ]);
    });

    /** A diff on an unchanged row is pure waste, so it runs behind equality. */
    it("runs the diff only where equality already failed", () => {
      const source = sourceOf(JIT.reconcile(Users).changes("diff"));
      const equalAt = source.indexOf("__reconcileEqual");
      const diffAt = source.indexOf("__reconcileDiff");

      expect(equalAt).toBeGreaterThan(-1);
      expect(diffAt).toBeGreaterThan(equalAt);
    });

    it("carries no diff when it was not asked for", () => {
      expect(sourceOf(JIT.reconcile(Users))).not.toContain("__reconcileDiff");
    });
  });

  describe("sinks", () => {
    it("streams every result without building a single array", () => {
      const iterate = JIT.reconcile(Users).to.iterator();
      const events = [...iterate(previous, current)];

      expect(events.map((event) => event.type)).toEqual(["unchanged", "changed", "added", "removed"]);
      expect(sourceOf(iterate)).not.toContain("= [];");
      expect(sourceOf(iterate)).toContain("function* reconcile");
    });

    it("hands each result to a visitor, with no arrays and no generator frames", () => {
      const visit = JIT.reconcile(Users).to.visitor();
      const seen: string[] = [];

      visit(previous, current, {
        added: (value) => seen.push(`+${value.id}`),
        removed: (value) => seen.push(`-${value.id}`),
        changed: (_before, after) => seen.push(`~${after.id}`),
      });

      expect(seen).toEqual(["~2", "+4", "-3"]);
      expect(sourceOf(visit)).not.toContain("= [];");
      expect(sourceOf(visit)).not.toContain("yield");
    });

    it("passes the diff through to a visitor when one was asked for", () => {
      const visit = JIT.reconcile(Users).changes("diff").to.visitor();
      let captured: readonly unknown[] | undefined;

      visit(previous, current, { changed: (_before, _after, diff) => (captured = diff) });
      expect(captured).toEqual([{ type: "update", path: ["name"], value: "b!" }]);
    });

    it("answers the same results through every sink", () => {
      const eager = JIT.reconcile(Users)(previous, current);
      const streamed = [...JIT.reconcile(Users).to.iterator()(previous, current)];

      expect(streamed.filter((event) => event.type === "added").map((event) => event.value)).toEqual(eager.added);
      expect(streamed.filter((event) => event.type === "removed").map((event) => event.value)).toEqual(eager.removed);
    });
  });

  describe("generated source", () => {
    it("indexes identity once and never searches twice", () => {
      const source = sourceOf(JIT.reconcile(Users));

      expect(source).not.toContain(".find(");
      expect(source).not.toContain(".indexOf(");
      expect(source).not.toContain("Object.keys");
      // One index build, one pass over current, one walk of what is left.
      expect(source.match(/new Map\(\)/g)).toHaveLength(1);
      expect(source.match(/for \(/g)).toHaveLength(3);
    });

    it("settles the common case on reference before reading a field", () => {
      expect(sourceOf(JIT.reconcile(Users))).toContain("previousItem === item ||");
    });
  });

  describe("edge cases", () => {
    it("treats an empty previous snapshot as all added", () => {
      const result = JIT.reconcile(Users)([], current);

      expect(result.added).toHaveLength(3);
      expect(result.removed).toEqual([]);
    });

    it("treats an empty current snapshot as all removed", () => {
      const result = JIT.reconcile(Users)(previous, []);

      expect(result.removed).toHaveLength(3);
      expect(result.added).toEqual([]);
    });

    it("reports nothing for two empty snapshots", () => {
      const result = JIT.reconcile(Users)([], []);

      expect(result).toEqual({ added: [], removed: [], changed: [], unchanged: [] });
    });

    it("is unaffected by the order rows arrive in", () => {
      const shuffled = [...current].reverse();
      const straight = JIT.reconcile(Users)(previous, current);
      const reversed = JIT.reconcile(Users)(previous, shuffled);

      expect(new Set(reversed.added)).toEqual(new Set(straight.added));
      expect(new Set(reversed.removed)).toEqual(new Set(straight.removed));
      expect(reversed.changed).toHaveLength(straight.changed.length);
    });

    it("reports the same identity appearing twice as one match and one addition", () => {
      const duplicated: User[] = [
        { id: 1, name: "a", score: 1 },
        { id: 1, name: "a", score: 1 },
      ];
      const result = JIT.reconcile(Users)([{ id: 1, name: "a", score: 1 }], duplicated);

      expect(result.unchanged).toHaveLength(1);
      expect(result.added).toHaveLength(1);
    });
  });
});
