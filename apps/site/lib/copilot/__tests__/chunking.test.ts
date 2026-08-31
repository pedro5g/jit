import { describe, expect, it } from "vitest";
import { parseDocument, toPlainText } from "../../../scripts/knowledge/parsers/docs";
import { chunkSection, MAX_CHUNK_CHARS } from "../../../scripts/knowledge/transform/chunk";
import { digest, embeddingHash, normalizeForHash } from "../../../scripts/knowledge/transform/normalize";

const fence = (lines: number) =>
  ["```ts", ...Array.from({ length: lines }, (_, i) => `const value${i} = 1;`), "```"].join("\n");

describe("chunker", () => {
  it("leaves a section that fits as one chunk", () => {
    const text = "A short paragraph.\n\nAnd another one.";
    expect(chunkSection(text)).toEqual([text]);
  });

  it("never splits a code fence", () => {
    // The failure this exists for: half a code block is worse than none. The
    // model reads a fragment of a chain as though it were the whole API.
    const long = `${"Prose. ".repeat(120)}\n\n${fence(60)}\n\n${"More prose. ".repeat(60)}`;
    const chunks = chunkSection(long);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const fences = (chunk.match(/```/g) ?? []).length;
      expect(fences % 2).toBe(0);
    }
  });

  it("keeps an over-long fence whole rather than producing two invalid programs", () => {
    const chunks = chunkSection(fence(200));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].length).toBeGreaterThan(MAX_CHUNK_CHARS);
  });

  it("splits prose at paragraph boundaries, never mid-sentence", () => {
    const paragraphs = Array.from({ length: 12 }, (_, i) => `Paragraph ${i}. ${"Filler words here. ".repeat(12)}`);
    const chunks = chunkSection(paragraphs.join("\n\n"));

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.trimEnd()).toMatch(/[.!?]$/);
  });

  it("folds a stub tail back into the piece before it", () => {
    const chunks = chunkSection(`${"Long paragraph. ".repeat(90)}\n\nTiny.`);
    expect(chunks[chunks.length - 1]).not.toBe("Tiny.");
    expect(chunks[chunks.length - 1]).toContain("Tiny.");
  });

  it("returns the original when there is nothing to split on", () => {
    const wall = "x".repeat(MAX_CHUNK_CHARS * 2);
    expect(chunkSection(wall)).toEqual([wall]);
  });
});

describe("hashing", () => {
  it("ignores changes that do not change what a reader sees", () => {
    const left = "One  paragraph.\r\n\r\n\r\nAnother.";
    const right = "One paragraph.\n\nAnother.";
    expect(normalizeForHash(left)).toBe(normalizeForHash(right));
    expect(digest(normalizeForHash(left))).toBe(digest(normalizeForHash(right)));
  });

  it("changes when the model or the pipeline changes", () => {
    const text = "Validate a UUID string.";
    const base = embeddingHash(text, "model-a", 1);

    expect(embeddingHash(text, "model-a", 1)).toBe(base);
    expect(embeddingHash(text, "model-b", 1)).not.toBe(base);
    expect(embeddingHash(text, "model-a", 2)).not.toBe(base);
  });
});

describe("mdx parser", () => {
  it("keeps code fences and drops JSX", () => {
    const { text, code } = toPlainText("<Callout>Note</Callout>\n\n```ts\nJIT.string();\n```");
    expect(text).toContain("JIT.string();");
    expect(text).not.toContain("<Callout>");
    expect(code).toEqual([{ lang: "ts", source: "JIT.string();" }]);
  });

  it("builds a breadcrumb from the heading trail", () => {
    const document = parseDocument(
      "reference/functions/equal.mdx",
      [
        "---",
        "title: equal",
        "---",
        "",
        "Intro prose.",
        "",
        "## Performance",
        "",
        "It is fast.",
        "",
        "### Cold start",
        "",
        "The first call compiles.",
      ].join("\n")
    );

    // "Performance" means nothing on its own; a dozen pages have that heading.
    expect(document.sections.map((section) => section.breadcrumb)).toEqual([
      "equal",
      "equal › Performance",
      "equal › Performance › Cold start",
    ]);
    expect(document.sections[1].anchor).toBe("performance");
  });

  it("does not read a heading inside a code fence", () => {
    const document = parseDocument(
      "x.mdx",
      ["---", "title: x", "---", "", "```md", "## Not a heading", "```"].join("\n")
    );
    expect(document.sections).toHaveLength(1);
    expect(document.sections[0].heading).toBe("x");
  });

  it("marks a section that is mostly a table", () => {
    const document = parseDocument(
      "x.mdx",
      [
        "---",
        "title: x",
        "---",
        "",
        "## Matrix",
        "",
        "| API | Purpose |",
        "| --- | --- |",
        "| `JIT.clone` | copies |",
        "| `JIT.equal` | compares |",
      ].join("\n")
    );

    expect(document.sections[0].dense).toBe(true);
  });
});
