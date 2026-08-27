import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expectTypeOf } from "vitest";

import { JIT as DefineJIT } from "../../define.js";
import { AOT, Compiler, JIT } from "../../index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";

const Event = JIT.object({ id: JIT.number().int(), name: JIT.string(), active: JIT.boolean() });
const text =
  '{"id":1,"name":"Ada","active":true}\n{"id":2,"name":"Grace","active":false}\n{"id":3,"name":"Lin","active":true}\n';

function sourceOf(value: object): string {
  const artifact = getArtifact(value);

  if (artifact?.kind !== "ndjson-plan") throw new Error("NDJSON plan not registered");
  return Compiler.emitNdjsonSource(artifact.descriptor);
}

describe("JIT.ndjson", () => {
  it("parses and validates one document per line", () => {
    expect(JIT.ndjson.parse(Event)(text)).toEqual([
      { id: 1, name: "Ada", active: true },
      { id: 2, name: "Grace", active: false },
      { id: 3, name: "Lin", active: true },
    ]);
    expect(() => JIT.ndjson.parse(Event)('{"id":"bad","name":"Ada","active":true}')).toThrow(/line 1/);
    expect(() => JIT.ndjson.parse(Event)("{bad}")).toThrow(/malformed NDJSON on line 1/);
    expect(() => JIT.ndjson.parse(Event)('\n{"id":"bad","name":"Ada","active":true}')).toThrow(/line 2/);
  });

  it("preserves UTF-8 and line state across chunks", () => {
    const bytes = new TextEncoder().encode('{"id":1,"name":"Vitória","active":true}\n');
    const accent = bytes.indexOf(195);

    expect(JIT.ndjson.parse(Event)([bytes.slice(0, accent + 1), bytes.slice(accent + 1)])).toEqual([
      { id: 1, name: "Vitória", active: true },
    ]);
    expect(JIT.ndjson.parse(Event)(['{"id":2,"name":"Grace",', '"active":false}\n'])).toEqual([
      { id: 2, name: "Grace", active: false },
    ]);
  });

  it("offers incremental iterator and direct visitor sinks", () => {
    const parse = JIT.ndjson.parse(Event);
    const visited: JIT.Typeof<typeof Event>[] = [];

    expect([...parse.to.iterator()(text)]).toEqual(parse(text));
    expect(parse.to.visitor()(text, (row) => visited.push(row))).toBe(3);
    expect(visited).toEqual(parse(text));
    expectTypeOf(parse.to.iterator()).returns.toEqualTypeOf<IterableIterator<JIT.Typeof<typeof Event>>>();
  });

  it("uses the specialized serializer for string and iterator output", () => {
    const rows = JIT.ndjson.parse(Event)(text);
    const stringify = JIT.ndjson.stringify(Event);

    expect(stringify(rows)).toBe(text.trimEnd());
    expect([...stringify.to.iterator()(rows)].join("")).toBe(text);
  });

  it("fuses validation, filters, projection and NDJSON output in one line pass", () => {
    const pipeline = JIT.ndjson
      .parse(Event)
      .validate()
      .where((query) => query.eq("active", true))
      .where((query) => query.gte("id", 3))
      .select("id", "name")
      .to.ndjson();
    const source = sourceOf(pipeline);

    expect(pipeline(text)).toBe('{"id":3,"name":"Lin"}');
    expect(source).toContain("const decoder = new TextDecoder()");
    expect(source).toContain("if ((item.active === __q0) && (item.id >= __q1)) {");
    expect(source).not.toContain("const out = []");
    expect(source).not.toContain(".filter(");
    expect(source).not.toContain("function* ndjsonLines");
  });

  it("has runtime/define/AOT parity for a fused pipeline", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "jit-ndjson-"));
    const DEvent = DefineJIT.object({
      id: DefineJIT.number().int(),
      name: DefineJIT.string(),
      active: DefineJIT.boolean(),
    });
    const pipeline = DefineJIT.ndjson
      .parse(DEvent)
      .where((query) => query.eq("active", true))
      .select("id", "name")
      .to.ndjson();

    try {
      expect(() => pipeline(text)).toThrow(/AOT artifacts cannot be executed/);
      const result = AOT.generate({ artifacts: { pipeline }, outDir });
      const source = readFileSync(join(outDir, "index.js"), "utf8");
      const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
        readonly pipeline: (input: Compiler.NdjsonInput) => string;
      };

      expect(result.skipped).toHaveLength(0);
      expect(source).not.toContain("@jit-compiler/jit");
      expect(source).not.toContain("const out = []");
      expect(generated.pipeline(text)).toBe(
        JIT.ndjson
          .parse(Event)
          .where((query) => query.eq("active", true))
          .select("id", "name")
          .to.ndjson()(text)
      );
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
