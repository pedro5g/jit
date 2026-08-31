import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { docRoute, Routes, resolvePath, routeIdForPath, STATIC_ROUTES } from "../config/routes";
import {
  chunkId,
  isRouteId,
  isSymbolId,
  knowledgeId,
  parseRouteId,
  parseSymbolId,
  routeId,
  slugSegment,
  symbolId,
  symbolPath,
} from "../core/value-objects/ids";
import { detectLocale, LOCALES, parseLocale } from "../core/value-objects/locale";

const coreDir = path.resolve(import.meta.dirname, "../core");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const abs = path.join(dir, entry);
    return statSync(abs).isDirectory() ? walk(abs) : [abs];
  });
}

/**
 * The file with its comments removed.
 *
 * Every module in this layer is more comment than code, and the prose quotes
 * the very things the assertions look for — `fetch`, `document`, a breadcrumb
 * that happens to contain the word "from". Scanning the raw text made both
 * checks fail on their own documentation, which is the least useful kind of
 * false positive: it teaches you to loosen the assertion.
 */
function code(file: string): string {
  return (
    readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      // import specifiers are the other test's business, and `document-chunk`
      // contains the word `document`
      .replace(/^\s*import[\s\S]*?from\s+"[^"]+";$/gm, "")
  );
}

describe("core purity", () => {
  /**
   * §95's completion criterion, as a test rather than a promise.
   *
   * The whole reason for the layering is that the retrieval stack can be run
   * from a build script, from vitest and from a browser without changing. That
   * property is invisible until it breaks, and it breaks by someone adding one
   * convenient import — so it is asserted.
   */
  it("imports nothing outside itself", () => {
    const offenders: string[] = [];

    for (const file of walk(coreDir)) {
      for (const match of code(file).matchAll(/from\s+"([^"]+)"/g)) {
        const specifier = match[1];
        if (specifier.startsWith(".")) continue;
        offenders.push(`${path.relative(coreDir, file)} imports ${specifier}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("holds no runtime values that could reach for a global", () => {
    // Everything in core is a type or a pure function. A file that reads
    // `window`, `document`, `process` or `fetch` has left the layer.
    const offenders = walk(coreDir).filter((file) =>
      /\b(window|document|localStorage|navigator|process|fetch)\b/.test(code(file))
    );

    expect(offenders.map((file) => path.relative(coreDir, file))).toEqual([]);
  });
});

describe("stable ids", () => {
  it("prefixes every kind", () => {
    expect(knowledgeId("default", "values")).toBe("knowledge.default.values");
    expect(chunkId("docs", "quick-start", "0")).toBe("chunk.docs.quick-start.0");
    expect(routeId("docs", "reference", "functions", "string")).toBe("route.docs.reference.functions.string");
  });

  it("folds accents so a Portuguese heading and its plain spelling agree", () => {
    expect(slugSegment("Validação")).toBe("validacao");
    expect(slugSegment("Validacao")).toBe("validacao");
  });

  it("keeps symbol casing, because safeParse and safe-parse are different names", () => {
    expect(symbolId("JIT.validate.safeParse")).toBe("symbol.jit.validate.safeParse");
    expect(symbolId("jit.string.uuid")).toBe("symbol.jit.string.uuid");
    expect(symbolPath(symbolId("JIT.string.uuid"))).toBe("jit.string.uuid");
  });

  it("refuses ids that did not come from us", () => {
    expect(parseRouteId("route.docs.reference")).not.toBeNull();
    expect(parseRouteId("/docs/reference")).toBeNull();
    expect(parseRouteId("route.../../etc/passwd")).toBeNull();
    expect(parseRouteId("docs.reference")).toBeNull();
    expect(parseSymbolId("symbol.jit.string.uuid")).not.toBeNull();
    expect(parseSymbolId("symbol.jit.string().uuid()")).toBeNull();
    expect(isRouteId("route.")).toBe(false);
    expect(isSymbolId("symbol.")).toBe(false);
  });

  it("rejects an id built from nothing", () => {
    expect(() => knowledgeId("", "  ")).toThrow(/every segment is empty/);
  });
});

describe("locale", () => {
  it("falls back rather than throwing on an unknown tag", () => {
    expect(parseLocale("pt-BR")).toBe("pt-BR");
    expect(parseLocale("fr")).toBe("en");
    expect(parseLocale(null)).toBe("en");
  });

  it("reads the language a question was asked in", () => {
    expect(detectLocale("como faço para validar um uuid?")).toBe("pt-BR");
    expect(detectLocale("how do I validate a uuid?")).toBe("en");
    expect(detectLocale("qual a diferenca entre parse e safeParse")).toBe("pt-BR");
    expect(detectLocale("what is the difference between parse and safeParse")).toBe("en");
  });

  it("does not guess from an identifier alone", () => {
    // `JIT.string().uuid()` is the same sentence in both languages. Falling
    // back is correct; picking one at random is what a character-n-gram
    // detector does, and it is wrong half the time on exactly these.
    expect(detectLocale("JIT.string().uuid()")).toBe("en");
    expect(detectLocale("JIT.string().uuid()", "pt-BR")).toBe("pt-BR");
  });

  it("lists exactly the locales the artifacts are built for", () => {
    expect([...LOCALES]).toEqual(["en", "pt-BR"]);
  });
});

describe("route registry", () => {
  it("derives a doc route from the file that produces it", () => {
    expect(docRoute("reference/functions/string.mdx")).toEqual({
      id: "route.docs.reference.functions.string",
      path: "/docs/reference/functions/string",
      slug: ["reference", "functions", "string"],
    });
  });

  it("collapses index files onto their directory", () => {
    expect(docRoute("index.mdx").path).toBe("/docs");
    expect(docRoute("index.mdx").id).toBe(Routes.docs);
    expect(docRoute("reference/functions/index.mdx").path).toBe("/docs/reference/functions");
  });

  it("round-trips a path back to the id that produced it", () => {
    for (const file of ["index.mdx", "quick-start.mdx", "reference/functions/string.mdx"]) {
      const route = docRoute(file);
      expect(routeIdForPath(route.path)).toBe(route.id);
    }

    for (const route of STATIC_ROUTES) expect(routeIdForPath(route.path)).toBe(route.id);
  });

  it("ignores the anchor and trailing slash a browser supplies", () => {
    expect(routeIdForPath("/docs/quick-start#install")).toBe("route.docs.quick-start");
    expect(routeIdForPath("/docs/quick-start/")).toBe("route.docs.quick-start");
  });

  it("refuses a path that cannot have come from our own rule", () => {
    expect(routeIdForPath("/elsewhere")).toBeNull();
    expect(routeIdForPath("/docs/Reference")).toBeNull();
    expect(routeIdForPath("https://example.com/docs/x")).toBeNull();
  });

  it("resolves without a locale prefix while the site is single-locale", () => {
    expect(resolvePath("/docs/quick-start", "pt-BR")).toBe("/docs/quick-start");
    expect(resolvePath("/", "en")).toBe("/");
  });
});
