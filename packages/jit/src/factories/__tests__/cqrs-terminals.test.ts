import { Compiler, JIT } from "../../index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";

describe("CQRS terminal sinks", () => {
  const User = JIT.object({
    id: JIT.number(),
    name: JIT.string(),
    active: JIT.boolean(),
  });
  type User = JIT.Typeof<typeof User>;
  const Users = JIT.array(User);

  const rows: User[] = [
    { id: 1, name: "Ada", active: false },
    { id: 2, name: "Grace", active: true },
    { id: 3, name: "Edsger", active: true },
  ];

  function sourceOf(compiled: object): string {
    const artifact = getArtifact(compiled);

    if (artifact?.kind !== "query-plan") throw new Error("query plan artifact not registered");
    return Compiler.emitQuerySource(artifact.schema, artifact.program as never);
  }

  it("returns the first matching row from inside the loop", () => {
    const firstActive = JIT.cqrs
      .query(Users)
      .where((query) => query.eq("active", true))
      .first();

    expect(firstActive(rows)).toEqual({ id: 2, name: "Grace", active: true });
    expect(firstActive(rows)).toBe(rows[1]);
    expectTypeOf(firstActive(rows)).toEqualTypeOf<User | undefined>();

    const source = sourceOf(firstActive);

    // No result array, no cursor: the answer leaves the loop directly.
    expect(source).toContain("return item;");
    expect(source).not.toContain("new Array");
    expect(source).not.toContain("out[");
  });

  it("returns undefined when nothing matches", () => {
    const missing = JIT.cqrs
      .query(Users)
      .where((query) => query.gt("id", 99))
      .first();

    expect(missing(rows)).toBeUndefined();
  });

  it("projects the single row when select precedes first", () => {
    const firstName = JIT.cqrs
      .query(Users)
      .where((query) => query.eq("active", true))
      .select("name")
      .first();

    expect(firstName(rows)).toEqual({ name: "Grace" });
    expectTypeOf(firstName(rows)).toEqualTypeOf<{ name: string } | undefined>();
  });

  it("answers some and every without building anything", () => {
    const anyActive = JIT.cqrs
      .query(Users)
      .where((query) => query.eq("active", true))
      .some();
    const allActive = JIT.cqrs
      .query(Users)
      .where((query) => query.eq("active", true))
      .every();
    const allPositive = JIT.cqrs
      .query(Users)
      .where((query) => query.gt("id", 0))
      .every();

    expect(anyActive(rows)).toBe(true);
    expect(allActive(rows)).toBe(false);
    expect(allPositive(rows)).toBe(true);
    expectTypeOf(anyActive(rows)).toEqualTypeOf<boolean>();

    expect(sourceOf(anyActive)).toContain("return true;");
    expect(sourceOf(anyActive)).toContain("return false;");
    // `every` exits on the first row the filter rejects.
    expect(sourceOf(allActive)).toContain("!==");
  });

  it("reports the input index, or -1", () => {
    const indexOfEdsger = JIT.cqrs
      .query(Users)
      .where((query) => query.eq("name", "Edsger"))
      .findIndex();
    const missing = JIT.cqrs
      .query(Users)
      .where((query) => query.gt("id", 99))
      .findIndex();

    expect(indexOfEdsger(rows)).toBe(2);
    expect(missing(rows)).toBe(-1);
    expectTypeOf(indexOfEdsger(rows)).toEqualTypeOf<number>();
    expect(sourceOf(indexOfEdsger)).toContain("return i;");
  });

  it("stops reading the collection once the answer is known", () => {
    let reads = 0;
    const watched = new Proxy(rows, {
      get(target, key, receiver) {
        if (typeof key === "string" && Number.isInteger(Number(key))) reads++;
        return Reflect.get(target, key, receiver);
      },
    });
    const firstActive = JIT.cqrs
      .query(Users)
      .where((query) => query.eq("active", true))
      .first();

    expect(firstActive(watched)).toBe(rows[1]);
    // Two rows read out of three: the scan ends at the match.
    expect(reads).toBe(2);
  });

  it("carries the terminal into the structural ~query contract", () => {
    const firstActive = JIT.cqrs
      .query(Users)
      .where((query) => query.eq("active", true))
      .first();

    expect(firstActive["~query"].definition.pipeline).toContainEqual({ kind: "terminal", operation: "first" });
  });

  it("reports early termination and no per-result allocation in explain", () => {
    const anyActive = JIT.cqrs
      .query(Users)
      .where((query) => query.eq("active", true))
      .some();
    const firstName = JIT.cqrs
      .query(Users)
      .where((query) => query.eq("active", true))
      .select("name")
      .first();

    expect(anyActive.explain()).toMatchObject({ earlyTermination: true, estimatedAllocationsPerResult: 0 });
    expect(firstName.explain()).toMatchObject({ earlyTermination: true, estimatedAllocationsPerResult: 1 });
  });

  it("rejects the chains a terminal cannot answer from inside the loop", () => {
    expect(() => JIT.cqrs.query(Users).orderBy("id").first()(rows)).toThrow(/cannot be combined with/i);
    expect(() => JIT.cqrs.query(Users).count().some()(rows)).toThrow(/cannot be combined with/i);
    expect(() => JIT.cqrs.query(Users).unique("id").first()(rows)).toThrow(/cannot be combined with/i);
    // A scalar answer has no rows to project.
    expect(() => JIT.cqrs.query(Users).select("name").some()(rows)).toThrow(/select has no effect/i);
    // And no stream to feed.
    expect(() => JIT.cqrs.query(Users).first().to.iterator()).toThrow(/cannot feed an iterator/i);
    expect(() => JIT.cqrs.query(Users).some().lazy()(rows)).toThrow(/cannot feed an iterator/i);
  });
});
