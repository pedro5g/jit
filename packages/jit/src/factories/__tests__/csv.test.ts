import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expectTypeOf } from "vitest";

import { JIT as DefineJIT } from "../../define.js";
import { AOT, Compiler, JIT } from "../../index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";

const Row = JIT.object({
  id: JIT.number().int(),
  name: JIT.string(),
  active: JIT.boolean(),
  note: JIT.string().nullable(),
  role: JIT.string().default("reader"),
});

function sourceOf(value: object): string {
  const artifact = getArtifact(value);

  if (artifact?.kind !== "csv-plan") throw new Error("CSV plan not registered");
  return Compiler.emitCsvSource(artifact.descriptor);
}

describe("JIT.csv", () => {
  const text = 'id,name,active,note,role\r\n1,"Ada, Lovelace",true,"line 1\nline 2",admin\r\n2,"A ""quote""",false,,';

  it("parses RFC 4180 quoting, CRLF, embedded newlines, nulls and defaults", () => {
    expect(JIT.csv.parse(Row)(text)).toEqual([
      { id: 1, name: "Ada, Lovelace", active: true, note: "line 1\nline 2", role: "admin" },
      { id: 2, name: 'A "quote"', active: false, note: null, role: "reader" },
    ]);
  });

  it("keeps its FSM state across arbitrary text and UTF-8 chunk boundaries", () => {
    const encoded = new TextEncoder().encode("id,name,active,note,role\n1,Vitória,true,,admin");
    const accent = encoded.indexOf(195);
    const chunks = [encoded.slice(0, accent + 1), encoded.slice(accent + 1)];

    expect(JIT.csv.parse(Row)(chunks)).toEqual([{ id: 1, name: "Vitória", active: true, note: null, role: "admin" }]);
  });

  it("supports direct iterator and visitor sinks without a result array", () => {
    const parse = JIT.csv.parse(Row);
    const visited: JIT.Typeof<typeof Row>[] = [];

    expect([...parse.to.iterator()(text)]).toEqual(parse(text));
    expect(parse.to.visitor()(text, (row) => visited.push(row))).toBe(2);
    expect(visited).toEqual(parse(text));
    expectTypeOf(parse.to.iterator()).returns.toEqualTypeOf<IterableIterator<JIT.Typeof<typeof Row>>>();
  });

  it("stringifies deterministically and round-trips schema values", () => {
    const rows = JIT.csv.parse(Row)(text);
    const stringify = JIT.csv.stringify(Row);
    const serialized = stringify(rows);

    expect(serialized).toContain('"Ada, Lovelace"');
    expect(serialized).toContain('"A ""quote"""');
    expect(JIT.csv.parse(Row)(serialized)).toEqual(rows);
    expect([...stringify.to.iterator()(rows)].join("")).toBe(`${serialized}\r\n`);
  });

  it("supports explicit columns, delimiters and headerless data", () => {
    const Small = JIT.object({ id: JIT.number().int(), name: JIT.string() });
    const parse = JIT.csv.parse(Small, {
      delimiter: ";",
      columns: { id: "identifier", name: "full name" },
    });

    expect(parse("full name;identifier\nAda;7")).toEqual([{ id: 7, name: "Ada" }]);
    expect(JIT.csv.parse(Small, { delimiter: ";", header: false })("8;Grace")).toEqual([{ id: 8, name: "Grace" }]);
    expect(() => parse("identifier\n7")).toThrow(/missing CSV column full name/);
  });

  it("emits a scanner and static row access rather than split/map/filter chains", () => {
    const source = sourceOf(JIT.csv.parse(Row));

    expect(source).toContain("const decoder = new TextDecoder()");
    expect(source).toContain('"id": c0 === ""');
    expect(source).not.toContain(".split(");
    expect(source).not.toContain("Object.keys");
    expect(source).not.toContain("function* csvRecords");
  });

  it("has runtime/define/AOT parity for parse and stringify", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "jit-csv-"));
    const DRow = DefineJIT.object({
      id: DefineJIT.number().int(),
      name: DefineJIT.string(),
      active: DefineJIT.boolean(),
      note: DefineJIT.string().nullable(),
      role: DefineJIT.string().default("reader"),
    });
    const parse = DefineJIT.csv.parse(DRow);
    const stringify = DefineJIT.csv.stringify(DRow);

    try {
      expect(() => parse(text)).toThrow(/AOT artifacts cannot be executed/);
      const result = AOT.generate({ artifacts: { parse, stringify }, outDir });
      const source = readFileSync(join(outDir, "index.js"), "utf8");
      const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
        readonly parse: (input: Compiler.CsvInput) => JIT.Typeof<typeof Row>[];
        readonly stringify: (rows: readonly JIT.Typeof<typeof Row>[]) => string;
      };

      expect(result.skipped).toHaveLength(0);
      expect(source).not.toContain("@jit-compiler/jit");
      const rows = generated.parse(text);
      expect(rows).toEqual(JIT.csv.parse(Row)(text));
      expect(generated.stringify(rows)).toBe(JIT.csv.stringify(Row)(rows));
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
