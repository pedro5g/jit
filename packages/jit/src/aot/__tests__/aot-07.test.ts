import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AOT, JIT } from "../../index.js";
import { registerAotTestHooks } from "./aot-test-utils.js";

let outDir: string;
registerAotTestHooks((directory) => {
  outDir = directory;
});

it("should generate a standalone runnable module for callback-free operations", async () => {
  const Event = JIT.object({
    id: JIT.number(),
    kind: JIT.literal("click"),
    target: JIT.string().pii(),
    body: JIT.string().sanitize(),
    at: JIT.date(),
  });
  const WireEvent = JIT.object({
    id: JIT.number(),
    kind: JIT.literal("click"),
    target: JIT.string(),
  });
  const result = AOT.generate({
    artifacts: {
      Event_equal: JIT.compare.equal(Event),
      Event_clone: JIT.clone(Event),
      Event_diff: JIT.compare.diff(Event),
      Event_stringify: JIT.json.stringify(Event),
      Event_fromJSON: JIT.json.parse(WireEvent).validate(),
      Event_mask: JIT.security.mask(Event),
      Event_sanitize: JIT.security.sanitize(Event),
      Event_codec: JIT.binary.codec(Event),
    },
    outDir,
  });
  const source = readFileSync(join(outDir, "index.js"), "utf8");

  expect(source).not.toContain('from "@jit-compiler/jit"');
  expect(source).toContain("JSON.parse");
  expect(result.skipped).toHaveLength(0);

  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    Event_equal: (left: unknown, right: unknown) => boolean;
    Event_clone: <T>(value: T) => T;
    Event_diff: (left: unknown, right: unknown) => readonly unknown[];
    Event_stringify: (value: unknown) => string;
    Event_fromJSON: (json: string) => unknown;
    Event_mask: <T>(value: T) => T;
    Event_sanitize: <T>(value: T) => T;
    Event_codec: {
      encode: (value: unknown) => Uint8Array;
      decode: (bytes: Uint8Array) => unknown;
    };
  };
  const event = {
    id: 7,
    kind: "click" as const,
    target: "secret-target",
    body: "<script>x()</script>hello",
    at: new Date("2026-07-05T00:00:00.000Z"),
  };

  expect(generated.Event_equal(event, { ...event })).toBe(true);
  expect(generated.Event_clone(event)).toEqual(event);
  expect(generated.Event_diff(event, { ...event, target: "next" })).toEqual([
    { type: "update", path: ["target"], value: "next" },
  ]);
  expect(generated.Event_stringify(event)).toBe(JSON.stringify(event));
  expect(generated.Event_fromJSON('{"id":7,"kind":"click","target":"next"}')).toEqual({
    id: 7,
    kind: "click",
    target: "next",
  });
  expect(() => generated.Event_fromJSON('{"id":7}')).toThrow(/expected literal click/);
  expect(generated.Event_mask(event).target).toBe("***");
  expect(generated.Event_sanitize(event).body).toBe("hello");
  expect(generated.Event_codec.decode(generated.Event_codec.encode(event))).toEqual(event);
});

it("should re-emit binary rowset queries as import-free AOT source", async () => {
  const User = JIT.object({
    id: JIT.number().int32(),
    role: JIT.union(JIT.literal("admin"), JIT.literal("user")),
    active: JIT.boolean(),
    score: JIT.number().float32(),
  });
  const Users = JIT.array(User);
  const binary = Users.binary({ strategy: "exact", memoryLayout: "columnar" });
  const rowset = binary.load([
    { id: 1, role: "admin" as const, active: true, score: 10 },
    { id: 2, role: "user" as const, active: true, score: 7 },
    { id: 3, role: "admin" as const, active: false, score: 3 },
  ]);
  const ActiveAdmins = JIT.cqrs
    .query(rowset)
    .filter((q) => q.and(q.eq("role", "admin"), q.eq("active", true)))
    .select("id", "score");
  const result = AOT.generate({ groups: {}, artifacts: { ActiveAdmins }, outDir });
  const source = readFileSync(join(outDir, "index.js"), "utf8");
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    ActiveAdmins: (value: typeof rowset) => { readonly id: number; readonly score: number }[];
  };

  expect(result.skipped).toHaveLength(0);
  expect(source).not.toContain('from "@jit-compiler/jit"');
  expect(source).toContain("function query(rowset)");
  expect(source).toContain("const offsets = rowset.offsets");
  expect(source).toContain("u8[b0 + i]");
  expect(source).toContain("int32[b2 + i]");
  expect(source).not.toContain("rowset.view");
  expect(generated.ActiveAdmins(rowset)).toEqual([{ id: 1, score: 10 }]);
});
