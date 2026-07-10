import { Compiler, Errors, JIT } from "../../index.js";

describe("JIT compiler watch", () => {
  const User = JIT.object({
    id: JIT.number(),
    name: JIT.string(),
    role: JIT.string(),
  });
  const Users = JIT.array(User);

  const ada = { id: 1, name: "Ada", role: "admin" };
  const grace = { id: 2, name: "Grace", role: "user" };
  const alan = { id: 3, name: "Alan", role: "user" };
  const adaUpdated = { id: 1, name: "Ada Lovelace", role: "admin" };

  it("should compile watched-list results for arrays", () => {
    const watch = JIT.watch(Users, { key: "id" });
    const result = watch([ada, grace], [adaUpdated, alan]);
    const source = Compiler.emitWatchSource(Users.schema, { key: "id" });

    expect(result).toEqual({
      currentItems: [adaUpdated, alan],
      initialItems: [ada, grace],
      newItems: [alan],
      removedItems: [grace],
      updatedItems: [{ previous: ada, current: adaUpdated }],
      isChanged: true,
    });
    expect(source).toContain("const previousIndex = new Map();");
    expect(source).toContain("previousIndex.set(id, previousItem);");
    expect(source).toContain("currentIndex.set(id, item);");
    expect(source).toBe(`function watch(previous, current) {
  const previousIndex = new Map();
  const currentIndex = new Map();
  const initialItems = [];
  for (let i = 0, len = previous.length; i < len; i++) {
    const previousItem = previous[i];
    const id = previousItem.id;
    previousIndex.set(id, previousItem);
    initialItems[initialItems.length] = previousItem;
  }
  const currentItems = [];
  const newItems = [];
  const removedItems = [];
  const updatedItems = [];
  for (let i = 0, len = current.length; i < len; i++) {
    const item = current[i];
    const id = item.id;
    currentIndex.set(id, item);
    currentItems[currentItems.length] = item;
    const previousItem = previousIndex.get(id);
    if (previousItem === undefined) {
      newItems[newItems.length] = item;
    } else if (previousItem !== item) {
      updatedItems[updatedItems.length] = { previous: previousItem, current: item };
    }
  }
  for (let i = 0, len = previous.length; i < len; i++) {
    const previousItem = previous[i];
    const id = previousItem.id;
    if (!currentIndex.has(id)) {
      removedItems[removedItems.length] = previousItem;
    }
  }
  const isChanged = newItems.length !== 0 || removedItems.length !== 0 || updatedItems.length !== 0;
  return { currentItems, initialItems, newItems, removedItems, updatedItems, isChanged };
}`);
    expectNoWatchedListInterpretation(source);
    expectTypeOf(result.updatedItems).toEqualTypeOf<
      {
        readonly previous: {
          id: number;
          name: string;
          role: string;
        };
        readonly current: {
          id: number;
          name: string;
          role: string;
        };
      }[]
    >();
  });

  it("should report unchanged keyed references", () => {
    const watch = JIT.watch(Users, { key: "id" });
    const result = watch([ada, grace], [ada, grace]);

    expect(result.newItems).toEqual([]);
    expect(result.removedItems).toEqual([]);
    expect(result.updatedItems).toEqual([]);
    expect(result.isChanged).toBe(false);
  });

  it("should support Set watched lists", () => {
    const watch = JIT.watch(JIT.set(User), { key: "id" });
    const result = watch(new Set([ada, grace]), new Set([adaUpdated, alan]));
    const source = Compiler.emitWatchSource(JIT.set(User).schema, { key: "id" });

    expect(result.currentItems).toEqual([adaUpdated, alan]);
    expect(result.newItems).toEqual([alan]);
    expect(result.removedItems).toEqual([grace]);
    expect(result.updatedItems).toEqual([{ previous: ada, current: adaUpdated }]);
    expect(source).toContain("for (const item of current)");
    expectNoWatchedListInterpretation(source);
  });

  it("should support Map watched lists over values", () => {
    const UserMap = JIT.map(JIT.number(), User);
    const watch = JIT.watch(UserMap, { key: "id" });
    const result = watch(
      new Map([
        [1, ada],
        [2, grace],
      ]),
      new Map([
        [1, adaUpdated],
        [3, alan],
      ])
    );
    const source = Compiler.emitWatchSource(UserMap.schema, { key: "id" });

    expect(result.initialItems).toEqual([ada, grace]);
    expect(result.currentItems).toEqual([adaUpdated, alan]);
    expect(result.newItems).toEqual([alan]);
    expect(result.removedItems).toEqual([grace]);
    expect(result.updatedItems).toEqual([{ previous: ada, current: adaUpdated }]);
    expect(source).toContain("for (const entry of current)");
    expect(source).toContain("const item = entry[1];");
    expectNoWatchedListInterpretation(source);
  });

  it("should call event handlers exactly once per change", () => {
    const added: (typeof alan)[] = [];
    const removed: (typeof grace)[] = [];
    const updated: Array<[typeof ada, typeof adaUpdated]> = [];
    const watch = JIT.watch(Users, {
      key: "id",
      onAdd: (item) => {
        added[added.length] = item;
      },
      onRemove: (item) => {
        removed[removed.length] = item;
      },
      onUpdate: (previous, current) => {
        updated[updated.length] = [previous, current];
      },
    });
    const source = Compiler.emitWatchSource(Users.schema, {
      key: "id",
      onAdd: () => undefined,
      onRemove: () => undefined,
      onUpdate: () => undefined,
    });

    watch([ada, grace], [adaUpdated, alan]);

    expect(added).toEqual([alan]);
    expect(removed).toEqual([grace]);
    expect(updated).toEqual([[ada, adaUpdated]]);
    expect(source).toContain("__w0(item);");
    expect(source).toContain("__w1(previousItem);");
    expect(source).toContain("__w2(previousItem, item);");
    expect(source).not.toContain("onAdd");
    expect(source).not.toContain("onRemove");
    expect(source).not.toContain("onUpdate");
  });

  it("should reject unknown watch keys", () => {
    expect(() => JIT.watch(Users, { key: "missing" as "id" })).toThrow(Errors.JITError);

    const typecheckOnly = false as boolean;

    if (typecheckOnly) {
      // @ts-expect-error watch keys must exist on collection items.
      JIT.watch(Users, { key: "missing" });
    }
  });
});

function expectNoWatchedListInterpretation(source: string): void {
  expect(source).not.toContain(".filter(");
  expect(source).not.toContain(".map(");
  expect(source).not.toContain(".reduce(");
  expect(source).not.toContain(".some(");
  expect(source).not.toContain(".push(");
}
