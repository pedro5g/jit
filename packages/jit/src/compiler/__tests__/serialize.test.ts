import { Compiler, Errors, JIT } from "../../index.js";

describe("JIT compiler serialize + codec", () => {
  const User = JIT.object({
    id: JIT.number(),
    name: JIT.string(),
    active: JIT.boolean(),
    nickname: JIT.optional(JIT.string()),
    score: JIT.nullable(JIT.number()),
    tags: JIT.array(JIT.string()),
    profile: JIT.object({ age: JIT.number(), city: JIT.string() }),
  });

  const ada = {
    id: 1,
    name: 'Ada "the first" <programmer>',
    active: true,
    nickname: undefined,
    score: null,
    tags: ["math", "poetry"],
    profile: { age: 36, city: "London" },
  };

  describe("serialize", () => {
    it("should match JSON.stringify byte-for-byte", () => {
      const stringify = Compiler.compileSerialize(User.schema);

      expect(stringify(ada)).toBe(JSON.stringify(ada));
      expect(stringify({ ...ada, nickname: "countess" })).toBe(JSON.stringify({ ...ada, nickname: "countess" }));
      expect(stringify({ ...ada, score: 99.5 })).toBe(JSON.stringify({ ...ada, score: 99.5 }));
    });

    it("should handle NaN, Infinity, dates, literals, and empty containers like JSON", () => {
      const Edge = JIT.object({
        value: JIT.number(),
        when: JIT.date(),
        kind: JIT.literal("event"),
        items: JIT.array(JIT.number()),
      });
      const stringify = Compiler.compileSerialize(Edge.schema);
      const edge = {
        value: Number.NaN,
        when: new Date("2026-07-05T00:00:00.000Z"),
        kind: "event" as const,
        items: [],
      };

      expect(stringify(edge)).toBe(JSON.stringify(edge));
    });

    it("should escape strings identically to JSON.stringify through the fast path", () => {
      const Text = JIT.object({ body: JIT.string() });
      const stringify = Compiler.compileSerialize(Text.schema);
      const samples = [
        "plain",
        "",
        'with "quotes" inside',
        "back\\slash",
        "line\nbreak\tandbell",
        "emoji 🚀 and accents àéî",
        "\ud800", // lone surrogate
        "a".repeat(41), // last char-scan length
        "b".repeat(42), // first regex-probe length
        `${"c".repeat(100)}"quote at the end`,
        "d".repeat(4096),
      ];

      for (const body of samples) {
        expect(stringify({ body })).toBe(JSON.stringify({ body }));
      }
    });

    it("should skip the string helper for stringless shapes", () => {
      const Numbers = JIT.object({ a: JIT.number(), b: JIT.boolean() });
      const source = Compiler.emitSerializeSource(Numbers.schema);

      expect(source).not.toContain("function str(");
    });

    it("should bake static keys into the source without reflection", () => {
      const source = Compiler.emitSerializeSource(User.schema);

      expect(source).toContain('\\"id\\":');
      expect(source).toContain('\\"profile\\":');
      expect(source).not.toContain("Object.keys(value)");
      expect(source).not.toContain("for (const");
    });

    it("should serialize records and tuples", () => {
      const Data = JIT.object({
        counts: JIT.record(JIT.string(), JIT.number()),
        pair: JIT.tuple(JIT.string(), JIT.number()),
      });
      const stringify = Compiler.compileSerialize(Data.schema);
      const value = {
        counts: { a: 1, b: 2 },
        pair: ["x", 7] as [string, number],
      };

      expect(stringify(value)).toBe(JSON.stringify(value));
    });

    it("should reject schemas JSON cannot represent", () => {
      expect(() => Compiler.compileSerialize(JIT.object({ big: JIT.bigint() }).schema)).toThrow(Errors.JITError);
      expect(() => Compiler.compileSerialize(JIT.object({ set: JIT.set(JIT.number()) }).schema)).toThrow(
        /UNSUPPORTED|does not support/
      );
    });

    it("should expose stringify and validated parse through JIT.serializer", () => {
      const Simple = JIT.object({
        id: JIT.number(),
        email: JIT.string().email(),
      });
      const json = JIT.serializer(Simple);
      const value = { id: 1, email: "ada@math.org" };

      expect(json.parse(json.stringify(value))).toEqual(value);
      expect(() => json.parse('{"id":1,"email":"nope"}')).toThrow(Errors.JITValidationError);
    });
  });

  describe("codec", () => {
    const Event = JIT.object({
      id: JIT.number(),
      kind: JIT.literal("click"),
      button: JIT.enum({ left: "left", right: "right" }),
      at: JIT.date(),
      target: JIT.string(),
      exact: JIT.boolean(),
      pressure: JIT.optional(JIT.number()),
      batch: JIT.array(JIT.object({ x: JIT.number(), y: JIT.number() })),
    });

    it("should round-trip values exactly", () => {
      const events = JIT.codec(Event);
      const event = {
        id: 42,
        kind: "click" as const,
        button: "right" as const,
        at: new Date("2026-07-05T12:34:56.789Z"),
        target: "botão-ação", // non-ascii utf-8
        exact: false,
        pressure: 0.75,
        batch: [
          { x: 1.5, y: 2.5 },
          { x: -3, y: 4 },
        ],
      };

      const bytes = events.encode(event);
      const decoded = events.decode(bytes);

      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(decoded).toEqual(event);
      expect(decoded.at.getTime()).toBe(event.at.getTime());
    });

    it("should encode presence bytes for optional and nullable fields", () => {
      const Maybe = JIT.object({
        a: JIT.optional(JIT.number()),
        b: JIT.nullable(JIT.number()),
      });
      const codec = JIT.codec(Maybe);

      expect(codec.decode(codec.encode({ a: undefined, b: null }))).toEqual({
        a: undefined,
        b: null,
      });
      expect(codec.decode(codec.encode({ a: 7, b: 8 }))).toEqual({
        a: 7,
        b: 8,
      });
    });

    it("should carry no field names on the wire", () => {
      const Point = JIT.object({ x: JIT.number(), y: JIT.number() });
      const Points = JIT.object({ items: JIT.array(Point) });
      const codec = JIT.codec(Points);
      const value = {
        items: Array.from({ length: 100 }, (_, index) => ({
          x: index + 0.123456789,
          y: index * 2.987654321,
        })),
      };

      const binary = codec.encode(value).byteLength;
      const json = JSON.stringify(value).length;

      // 1 version byte + u32 count + 100 * two float64s.
      expect(binary).toBe(1 + 4 + 100 * 16);
      expect(binary).toBeLessThan(json);
      expect(codec.decode(codec.encode(value))).toEqual(value);
    });

    it("should decode from ArrayBuffer and Uint8Array views", () => {
      const Simple = JIT.object({ id: JIT.number() });
      const codec = JIT.codec(Simple);
      const bytes = codec.encode({ id: 5 });

      expect(codec.decode(bytes.buffer.slice(0) as ArrayBuffer)).toEqual({
        id: 5,
      });
      expect(codec.decode(new Uint8Array(bytes))).toEqual({ id: 5 });
    });

    it("should encode literals as zero bytes", () => {
      const Tagged = JIT.object({
        kind: JIT.literal("ping"),
        seq: JIT.number(),
      });
      const codec = JIT.codec(Tagged);
      const bytes = codec.encode({ kind: "ping", seq: 1 });

      // 1 version byte + float64; the literal costs nothing.
      expect(bytes.byteLength).toBe(9);
      expect(codec.decode(bytes)).toEqual({ kind: "ping", seq: 1 });
    });

    it("should reject dynamically-typed schemas", () => {
      expect(() => JIT.codec(JIT.object({ meta: JIT.any() }))).toThrow(Errors.JITError);
      expect(() => JIT.codec(JIT.object({ meta: JIT.unknown() }))).toThrow(/rigid/);
    });
  });
});
