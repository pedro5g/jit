import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JIT } from "@jit-compiler/jit/runtime";
import { describe, expect, it } from "vitest";

const siteRoot = resolve(import.meta.dirname, "../../..");
const referenceRoot = resolve(siteRoot, "content/docs/reference/functions");
const indexPath = resolve(referenceRoot, "index.mdx");

function documentedReferences(source: string): ReadonlyMap<string, string> {
  const references = new Map<string, string>();
  const pattern = /`JIT\.([A-Za-z0-9_]+)`\s*\|\s*\[[^\]]+\]\(\.\/([^#)]+)(?:#[^)]+)?\)/g;

  for (const match of source.matchAll(pattern)) {
    const [, name, target] = match;

    if (name && target) references.set(name, target);
  }

  return references;
}

describe("public API documentation", () => {
  const source = readFileSync(indexPath, "utf8");
  const references = documentedReferences(source);

  it("documents every public JIT runtime member exactly through the API index", () => {
    expect([...references.keys()].sort()).toEqual(Object.keys(JIT).sort());
  });

  it("points every public member to an existing MDX page", () => {
    const missingPages = [...references].flatMap(([name, target]) => {
      const path = resolve(referenceRoot, `${target}.mdx`);
      return existsSync(path) ? [] : [`JIT.${name} -> ${path}`];
    });

    expect(missingPages).toEqual([]);
  });
});
