import { Compiler, JIT } from "../../index.js";

describe("JIT binary codec v2", () => {
  describe("schema versioning", () => {
    it("should stamp the version as byte 0 and reject mismatches on decode", () => {
      const Point = JIT.object({ x: JIT.number() });
      const v1 = JIT.codec(Point);
      const v7 = JIT.codec(Point, { version: 7 });

      expect(v1.encode({ x: 1 })[0]).toBe(1);
      expect(v7.encode({ x: 1 })[0]).toBe(7);
      expect(() => v1.decode(v7.encode({ x: 1 }))).toThrow(/version mismatch: expected 1, got 7/);
      expect(() => v7.decode(new Uint8Array(0))).toThrow(/version mismatch/);
      expect(v7.decode(v7.encode({ x: 2 }))).toEqual({ x: 2 });
    });

    it("should cache codecs per version", () => {
      const Point = JIT.object({ x: JIT.number() });

      expect(JIT.codec(Point)).toBe(JIT.codec(Point, { version: 1 }));
      expect(JIT.codec(Point)).not.toBe(JIT.codec(Point, { version: 2 }));
      Compiler.clearCompileCache();
    });

    it("should reject versions outside one byte", () => {
      const Point = JIT.object({ x: JIT.number() });

      expect(() => JIT.codec(Point, { version: 256 })).toThrow(/\[0, 255\]/);
      expect(() => JIT.codec(Point, { version: -1 })).toThrow(/\[0, 255\]/);
    });
  });

  describe("encodeInto", () => {
    const Message = JIT.object({ id: JIT.number().int(), body: JIT.string() });
    const codec = JIT.codec(Message);
    const message = { id: 42, body: "olá, binário" };

    it("should write into a caller buffer and report bytes written", () => {
      const scratch = new Uint8Array(256);
      const written = codec.encodeInto(message, scratch);

      expect(written).toBe(codec.encode(message).byteLength);
      expect(codec.decode(scratch.subarray(0, written))).toEqual(message);
    });

    it("should throw instead of silently truncating when the buffer is too small", () => {
      expect(() => codec.encodeInto(message, new Uint8Array(4))).toThrow(RangeError);
      expect(() => codec.encodeInto(message, new Uint8Array(0))).toThrow(RangeError);
    });
  });

  describe("typed numeric writes", () => {
    it("should encode explicit int schemas as 4-byte int32", () => {
      const Ids = JIT.object({ a: JIT.int(), b: JIT.int() });
      const codec = JIT.codec(Ids);
      const bytes = codec.encode({ a: -7, b: 2147483647 });

      expect(bytes.byteLength).toBe(1 + 4 + 4);
      expect(codec.decode(bytes)).toEqual({ a: -7, b: 2147483647 });
    });

    it("should throw on int32 overflow instead of corrupting", () => {
      const Ids = JIT.object({ a: JIT.int() });
      const codec = JIT.codec(Ids);

      expect(() => codec.encode({ a: 2147483648 })).toThrow(/int32 overflow/);
      expect(() => codec.encode({ a: 1.5 })).toThrow(/int32 overflow/);
    });

    it("should keep number().int() checks on the float64 wire (2^53 range)", () => {
      const Wide = JIT.object({ ts: JIT.number().int() });
      const codec = JIT.codec(Wide);
      const now = 1783641600000; // epoch millis exceed int32 on purpose

      expect(codec.decode(codec.encode({ ts: now }))).toEqual({ ts: now });
      expect(codec.encode({ ts: now }).byteLength).toBe(9);
    });

    it("should round-trip bigints as int64", () => {
      const Big = JIT.object({ n: JIT.bigint() });
      const codec = JIT.codec(Big);

      expect(codec.decode(codec.encode({ n: -(2n ** 62n) }))).toEqual({ n: -(2n ** 62n) });
      expect(codec.encode({ n: 5n }).byteLength).toBe(9);
    });
  });

  describe("optional bitmask", () => {
    it("should pack object optionals into 2-bit slots", () => {
      const Sparse = JIT.object({
        a: JIT.optional(JIT.number()),
        b: JIT.nullable(JIT.number()),
        c: JIT.optional(JIT.number()),
        d: JIT.optional(JIT.number()),
      });
      const codec = JIT.codec(Sparse);
      const allAbsent = codec.encode({ a: undefined, b: null, c: undefined, d: undefined });

      // 1 version byte + 1 mask byte covering all four fields, no payloads.
      expect(allAbsent.byteLength).toBe(2);
      expect(codec.decode(allAbsent)).toEqual({ a: undefined, b: null, c: undefined, d: undefined });

      const mixed = { a: 1.5, b: null, c: undefined, d: 4.5 };

      expect(codec.decode(codec.encode(mixed))).toEqual(mixed);
    });

    it("should keep later fields stable when earlier optionals are absent", () => {
      const Layout = JIT.object({
        head: JIT.optional(JIT.string()),
        tail: JIT.number(),
      });
      const codec = JIT.codec(Layout);

      expect(codec.decode(codec.encode({ head: undefined, tail: 9.25 }))).toEqual({ head: undefined, tail: 9.25 });
      expect(codec.decode(codec.encode({ head: "x", tail: 9.25 }))).toEqual({ head: "x", tail: 9.25 });
    });
  });

  describe("unions and intersections", () => {
    it("should encode plain unions with one tag byte", () => {
      const Value = JIT.object({ v: JIT.union(JIT.string(), JIT.number(), JIT.boolean()) });
      const codec = JIT.codec(Value);

      expect(codec.decode(codec.encode({ v: "text" }))).toEqual({ v: "text" });
      expect(codec.decode(codec.encode({ v: 3.5 }))).toEqual({ v: 3.5 });
      expect(codec.decode(codec.encode({ v: true }))).toEqual({ v: true });
      // 1 version + 1 tag + float64.
      expect(codec.encode({ v: 3.5 }).byteLength).toBe(10);
    });

    it("should encode discriminated unions by tag index with zero-byte literals", () => {
      const Event = JIT.discriminatedUnion("kind", [
        JIT.object({ kind: JIT.literal("click"), x: JIT.number(), y: JIT.number() }),
        JIT.object({ kind: JIT.literal("key"), code: JIT.string() }),
      ]);
      const codec = JIT.codec(Event);
      const click = { kind: "click" as const, x: 1.5, y: 2.5 };
      const key = { kind: "key" as const, code: "Enter" };

      expect(codec.decode(codec.encode(click))).toEqual(click);
      expect(codec.decode(codec.encode(key))).toEqual(key);
      // 1 version + 1 tag + two float64s; the discriminator costs nothing.
      expect(codec.encode(click).byteLength).toBe(18);
      expect(() => codec.encode({ kind: "scroll", delta: 2 } as never)).toThrow(/unknown discriminator/);
    });

    it("should encode object intersections field-by-field", () => {
      const Full = JIT.intersection(
        JIT.object({ id: JIT.number() }),
        JIT.object({ name: JIT.string(), active: JIT.boolean() })
      );
      const codec = JIT.codec(Full);
      const value = { id: 7, name: "Ada", active: true };

      expect(codec.decode(codec.encode(value))).toEqual(value);
    });
  });

  describe("collections", () => {
    it("should round-trip records, maps, sets, and tuples with rest", () => {
      const Payload = JIT.object({
        counts: JIT.record(JIT.string(), JIT.number()),
        meta: JIT.map(JIT.string(), JIT.number()),
        tags: JIT.set(JIT.string()),
        pair: JIT.tuple(JIT.string(), JIT.number()),
      });
      const codec = JIT.codec(Payload);
      const value = {
        counts: { "não-ascii": 1.5, plain: 2 },
        meta: new Map([
          ["a", 1],
          ["b", 2],
        ]),
        tags: new Set(["x", "y"]),
        pair: ["k", 9] as [string, number],
      };

      expect(codec.decode(codec.encode(value))).toEqual(value);
    });

    it("should reject truncated buffers instead of decoding garbage", () => {
      const Text = JIT.object({ body: JIT.string() });
      const codec = JIT.codec(Text);
      const bytes = codec.encode({ body: "hello world" });

      expect(() => codec.decode(bytes.subarray(0, 8))).toThrow(/truncated/);
    });
  });

  it("should expose encode, encodeInto, and decode from JIT.model", () => {
    const User = JIT.model(JIT.object({ id: JIT.number(), name: JIT.string() }));
    const scratch = new Uint8Array(128);
    const user = { id: 1, name: "Ada" };
    const written = User.codec.encodeInto(user, scratch);

    expect(User.codec.decode(scratch.subarray(0, written))).toEqual(user);
  });
});
