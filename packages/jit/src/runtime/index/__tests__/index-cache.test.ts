import { getIndex } from "../index.js";

describe("index runtime", () => {
  it("should build and reuse an index for the same array and key", () => {
    const users = [
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ];

    const first = getIndex(users, "id");
    const second = getIndex(users, "id");

    expect(first).toBe(second);
    expect(first.get(1)).toBe(users[0]);
    expect(first.get(2)).toBe(users[1]);
  });

  it("should rebuild the cached index when the key changes", () => {
    const users = [
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ];

    const byId = getIndex(users, "id");
    const byName = getIndex(users, "name");

    expect(byName).not.toBe(byId);
    expect(byName.get("Ada")).toBe(users[0]);
  });
});
