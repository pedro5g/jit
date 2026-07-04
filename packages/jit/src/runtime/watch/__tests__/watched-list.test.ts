import { JIT } from "../../../index.js";

describe("JIT WatchedList", () => {
  let list: JIT.WatchedList<number>;

  beforeEach(() => {
    list = new JIT.WatchedList([1, 2, 3]);
  });

  it("should create a watched list with initial items", () => {
    expect(list.getItems()).toHaveLength(3);
    expect(list.getInitialItems()).toEqual([1, 2, 3]);
    expect(list.isChanged()).toBe(false);
  });

  it("should add new items to the list", () => {
    list.add(4);

    expect(list.getItems()).toEqual([1, 2, 3, 4]);
    expect(list.getNewItems()).toEqual([4]);
    expect(list.isChanged()).toBe(true);
  });

  it("should remove items from the list", () => {
    list.remove(2);

    expect(list.getItems()).toEqual([1, 3]);
    expect(list.getRemovedItems()).toEqual([2]);
    expect(list.isChanged()).toBe(true);
  });

  it("should add an item even if it was removed before", () => {
    list.remove(2);
    list.add(2);

    expect(list.getItems()).toEqual([1, 3, 2]);
    expect(list.getNewItems()).toEqual([]);
    expect(list.getRemovedItems()).toEqual([]);
    expect(list.isChanged()).toBe(false);
  });

  it("should remove an item even if it was added before", () => {
    list.add(4);
    list.remove(4);

    expect(list.getItems()).toEqual([1, 2, 3]);
    expect(list.getNewItems()).toEqual([]);
    expect(list.getRemovedItems()).toEqual([]);
    expect(list.isChanged()).toBe(false);
  });

  it("should update watched list items", () => {
    list.update([1, 3, 5]);

    expect(list.getItems()).toEqual([1, 3, 5]);
    expect(list.getRemovedItems()).toEqual([2]);
    expect(list.getNewItems()).toEqual([5]);
    expect(list.snapshot()).toEqual({
      currentItems: [1, 3, 5],
      initialItems: [1, 2, 3],
      newItems: [5],
      removedItems: [2],
      updatedItems: [],
      isChanged: true,
    });
  });

  it("should compare object items by key without a custom compareItems implementation", () => {
    const ada = { id: 1, name: "Ada" };
    const grace = { id: 2, name: "Grace" };
    const adaUpdated = { id: 1, name: "Ada Lovelace" };
    const objectList = new JIT.WatchedList([ada, grace], { key: "id" });

    objectList.update([adaUpdated]);

    expect(objectList.getRemovedItems()).toEqual([grace]);
    expect(objectList.getNewItems()).toEqual([]);
    expect(objectList.getUpdatedItems()).toEqual([{ previous: ada, current: adaUpdated }]);
  });

  it("should create schema-aware watched lists", () => {
    const User = JIT.object({
      id: JIT.number(),
      name: JIT.string(),
    });
    const Users = JIT.array(User);
    const ada = { id: 1, name: "Ada" };
    const list = JIT.watchedList(Users, [ada], { key: "id" });

    expect(list).toBeInstanceOf(JIT.KeyedWatchedList);
    expect(list.exists({ id: 1, name: "Ada v2" })).toBe(true);
    expectTypeOf(list.getItems()).toEqualTypeOf<
      {
        readonly id: number;
        readonly name: string;
      }[]
    >();
  });

  it("should support subclass compareItems overrides", () => {
    class NumberWatchedList extends JIT.WatchedList<number> {
      public override compareItems(left: number, right: number): boolean {
        return left === right;
      }
    }

    const numbers = new NumberWatchedList([1, 2, 3]);

    numbers.remove(2);
    numbers.add(2);

    expect(numbers.getRemovedItems()).toEqual([]);
    expect(numbers.getNewItems()).toEqual([]);
  });

  it("should maintain key indexes across add remove and update operations", () => {
    const ada = { id: 1, name: "Ada" };
    const grace = { id: 2, name: "Grace" };
    const alan = { id: 3, name: "Alan" };
    const adaUpdated = { id: 1, name: "Ada Lovelace" };
    const list = new JIT.KeyedWatchedList([ada, grace], { key: "id" });

    list.remove({ id: 2, name: "Grace Hopper" });
    list.add({ id: 2, name: "Grace Restored" });
    list.update([adaUpdated, alan]);

    expect(list.exists({ id: 1, name: "Ada" })).toBe(true);
    expect(list.exists({ id: 2, name: "Grace" })).toBe(false);
    expect(list.getRemovedItems()).toEqual([{ id: 2, name: "Grace Restored" }]);
    expect(list.getNewItems()).toEqual([alan]);
    expect(list.getUpdatedItems()).toEqual([{ previous: ada, current: adaUpdated }]);
  });
});
