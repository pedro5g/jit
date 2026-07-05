import { Errors, JIT } from "../../index.js";

describe("JIT streaming validation", () => {
  const Event = JIT.object({
    id: JIT.number().int().positive(),
    name: JIT.string().min(2),
  });

  describe("array roots (progressive)", () => {
    it("should validate elements as chunks arrive, surviving tokens cut in half", () => {
      const seen: unknown[] = [];
      const stream = JIT.stream(JIT.array(Event), { onItem: (item) => seen.push(item) });

      stream.write('[{"id": 1, "name": "Andr');
      expect(seen).toHaveLength(0); // fragment stays buffered

      stream.write('ez"}, {"id": 2, "na');
      expect(seen).toEqual([{ id: 1, name: "Andrez" }]); // first element flushed

      stream.write('me": "Ada"}]');

      expect(stream.end()).toEqual([
        { id: 1, name: "Andrez" },
        { id: 2, name: "Ada" },
      ]);
      expect(seen).toHaveLength(2);
    });

    it("should abort on the first invalid element with its indexed path", () => {
      const stream = JIT.stream(JIT.array(Event));

      stream.write('[{"id": 1, "name": "Ada"},');

      try {
        stream.write('{"id": -5, "name": "x"}, {"id": 3, "name": "never reached"}]');
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(Errors.JITValidationError);

        const issues = (error as Errors.JITValidationError).issues;

        expect(issues.map((issue) => issue.path)).toEqual(["[1].id", "[1].name"]);
      }

      // A failed stream refuses further writes.
      expect(() => stream.write("[]")).toThrow(/already failed/);
    });

    it("should close the connection instantly when the root type is impossible", () => {
      const stream = JIT.stream(JIT.array(Event));

      try {
        stream.write('{"id": 1}');
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(Errors.JITValidationError);
        expect((error as Errors.JITValidationError).issues[0].expected).toBe("array");
      }
    });

    it("should reject structural violations mid-stream", () => {
      const unbalanced = JIT.stream(JIT.array(JIT.number()));

      unbalanced.write("[1, 2");
      expect(() => unbalanced.write("}]")).toThrow(/unbalanced/);

      const trailing = JIT.stream(JIT.array(JIT.number()));

      trailing.write("[1]");
      expect(() => trailing.write(" garbage")).toThrow(/after the root array/);

      const truncated = JIT.stream(JIT.array(JIT.number()));

      truncated.write("[1, 2");
      expect(() => truncated.end()).toThrow(/never closed/);
    });

    it("should reassemble utf-8 sequences split across byte chunks", () => {
      const encoder = new TextEncoder();
      const bytes = encoder.encode('[{"id": 7, "name": "coração"}]');
      const stream = JIT.stream(JIT.array(Event));

      // Split inside the multi-byte "ç".
      const cut = bytes.findIndex((byte) => byte === 0xc3);

      stream.write(bytes.subarray(0, cut + 1));
      stream.write(bytes.subarray(cut + 1));

      expect(stream.end()).toEqual([{ id: 7, name: "coração" }]);
    });

    it("should enforce array count checks, including early max abort", () => {
      const bounded = JIT.stream(JIT.array(JIT.number()).max(2));

      bounded.write("[1, 2, ");
      expect(() => bounded.write("3, 4]")).toThrow(/at most 2/);

      const min = JIT.stream(JIT.array(JIT.number()).min(2));

      min.write("[1]");
      expect(() => min.end()).toThrow(/at least 2/);

      const empty = JIT.stream(JIT.array(JIT.number()));

      empty.write("[]");
      expect(empty.end()).toEqual([]);
    });

    it("should handle nested structures and strings containing brackets", () => {
      const Nested = JIT.object({
        tags: JIT.array(JIT.string()),
        note: JIT.string(),
      });
      const stream = JIT.stream(JIT.array(Nested));

      stream.write('[{"tags": ["a", "b"], "note": "has ] and } inside"},');
      stream.write('{"tags": [], "note": "escaped \\" quote"}]');

      expect(stream.end()).toEqual([
        { tags: ["a", "b"], note: "has ] and } inside" },
        { tags: [], note: 'escaped " quote' },
      ]);
    });
  });

  describe("object and scalar roots", () => {
    it("should supervise structure per chunk and validate fully on end", () => {
      const stream = JIT.stream(Event);

      stream.write('{"id": 9, "na');
      stream.write('me": "Grace"}');

      expect(stream.end()).toEqual({ id: 9, name: "Grace" });
    });

    it("should reject wrong root kind and trailing garbage immediately", () => {
      const wrongRoot = JIT.stream(Event);

      expect(() => wrongRoot.write("[1]")).toThrow(/must be object/);

      const trailing = JIT.stream(Event);

      trailing.write('{"id": 1, "name": "Ada"}');
      expect(() => trailing.write("x")).toThrow(/after the root value/);
    });

    it("should apply parse transforms on end", () => {
      const Signup = JIT.object({ email: JIT.string().trim().lowercase().email() });
      const stream = JIT.stream(Signup);

      stream.write('{"email": "  Ada@Math.org  "}');

      expect(stream.end()).toEqual({ email: "ada@math.org" });
    });
  });

  describe("ndjson", () => {
    it("should validate one document per line with fragmented chunks", () => {
      const seen: number[] = [];
      const stream = JIT.stream(Event, {
        format: "ndjson",
        onItem: (_item, index) => seen.push(index),
      });

      stream.write('{"id": 1, "name": "Ada"}\n{"id": 2, "na');
      stream.write('me": "Grace"}\n');
      stream.write('{"id": 3, "name": "Marie"}');

      expect(stream.end()).toEqual([
        { id: 1, name: "Ada" },
        { id: 2, name: "Grace" },
        { id: 3, name: "Marie" },
      ]);
      expect(seen).toEqual([0, 1, 2]);
    });

    it("should fail fast with the offending line number", () => {
      const stream = JIT.stream(Event, { format: "ndjson" });

      stream.write('{"id": 1, "name": "Ada"}\n');

      try {
        stream.write('{"id": "not a number", "name": "x"}\n');
        expect.unreachable();
      } catch (error) {
        const issues = (error as Errors.JITValidationError).issues;

        expect(issues[0].path).toContain("line 1");
      }
    });
  });
});
