/**
 * Reads the documentation the way a reader would use it, and reports every
 * place it is wrong.
 *
 * The ghost answers out of these pages. A broken example in the docs is not a
 * documentation bug that a reader works around — it is a wrong answer with a
 * citation attached, which is worse than a wrong answer without one. So the
 * pages are held to what can actually be checked:
 *
 *   examples  — every ts/js block that uses jit is executed against the real
 *               library. This is the only check that catches an example which
 *               names nothing invented and still does not work.
 *   links     — every internal /docs link resolves to a page that exists.
 *   anchors   — every #fragment resolves to a heading on that page.
 *   api       — every JIT.* name mentioned outside the migration guide exists.
 *
 * Run from apps/site:  pnpm audit:docs
 * Exits non-zero when anything fails, so it can gate a build.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { JIT } from "@jit-compiler/jit/runtime";
import { extractTypeExports } from "./knowledge/parsers/api";
import { runExample } from "./knowledge/parsers/examples";

const siteDir = path.resolve(import.meta.dirname, "..");
const contentDir = path.join(siteDir, "content/docs");

interface Problem {
  file: string;
  kind: "example" | "link" | "anchor" | "api";
  detail: string;
}

const problems: Problem[] = [];

async function collect(dir: string, files: string[] = []): Promise<string[]> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) await collect(abs, files);
    else if (entry.name.endsWith(".mdx")) files.push(abs);
  }
  return files;
}

/** `content/docs/guides/mcp-server.mdx` -> `/docs/guides/mcp-server`. */
function urlFor(file: string): string {
  const relative = path.relative(contentDir, file).replaceAll(path.sep, "/");
  const slug = relative.replace(/\.mdx$/, "").replace(/(^|\/)index$/, "");
  return slug ? `/docs/${slug}` : "/docs";
}

function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const files = (await collect(contentDir)).sort();
const pages = new Map<string, Set<string>>();
const sources = new Map<string, string>();

// first pass: every page and the anchors it offers
for (const file of files) {
  const source = await fs.readFile(file, "utf8");
  sources.set(file, source);

  const anchors = new Set<string>();
  let insideFence = false;
  for (const line of source.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) insideFence = !insideFence;
    if (insideFence) continue;

    const heading = /^#{2,4}\s+(.+?)\s*$/.exec(line);
    if (heading) anchors.add(slugify(heading[1].replace(/`/g, "").trim()));
  }

  pages.set(urlFor(file), anchors);
}

/**
 * Every name a page may write as `JIT.x`.
 *
 * The type half is read out of `runtime.ts` rather than listed here. It was
 * listed here, as `["Typeof", "Strict"]`, and the library grew `Input`,
 * `Hydrate` and `Wire` — so this audit failed on a page that was correct,
 * which is the one kind of failure that trains you to ignore an audit.
 */
const typeExports = extractTypeExports(
  await fs.readFile(path.resolve(siteDir, "../../packages/jit/src/runtime.ts"), "utf8")
);
const knownApi = new Set([...Object.keys(JIT), ...typeExports]);
let examplesRun = 0;

// second pass: the checks
for (const file of files) {
  const source = sources.get(file) ?? "";
  const relative = path.relative(siteDir, file);
  const historical = /migrating-to-2|whats-new/.test(file);

  for (const match of source.matchAll(/```(?:ts|tsx|typescript|js|javascript)\n([\s\S]*?)```/g)) {
    const code = match[1] ?? "";
    if (!/\bJIT\./.test(code)) continue;
    // the migration guide's examples are removed APIs on purpose
    if (historical) continue;

    examplesRun += 1;
    const failure = await runExample(code);
    if (failure) {
      problems.push({ file: relative, kind: "example", detail: `${failure}\n      ${code.trim().split("\n")[0]}…` });
    }
  }

  // the `related:` frontmatter is a link like any other, and just as breakable
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] ?? "";
  const declaredRelated = /^related:\s*(.+)$/m.exec(frontmatter)?.[1] ?? "";
  for (const target of declaredRelated
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    if (!pages.has(target.split("#")[0])) {
      problems.push({ file: relative, kind: "link", detail: `related: ${target} — no such page` });
    }
  }

  for (const match of source.matchAll(/\]\((\/docs[^)\s]*)\)/g)) {
    const [target, anchor] = match[1].split("#");
    if (!pages.has(target)) {
      problems.push({ file: relative, kind: "link", detail: `${match[1]} — no such page` });
      continue;
    }
    if (anchor && !pages.get(target)?.has(anchor)) {
      problems.push({ file: relative, kind: "anchor", detail: `${match[1]} — no such heading on that page` });
    }
  }

  if (!historical) {
    for (const match of source.matchAll(/\bJIT\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
      if (!knownApi.has(match[1]))
        problems.push({ file: relative, kind: "api", detail: `JIT.${match[1]} does not exist` });
    }
  }
}

const byKind = new Map<Problem["kind"], Problem[]>();
for (const problem of problems) byKind.set(problem.kind, [...(byKind.get(problem.kind) ?? []), problem]);

console.log(`[audit-docs] ${files.length} pages · ${examplesRun} jit examples executed against the real library`);

for (const [kind, found] of byKind) {
  console.log(`\n  ${kind} (${found.length}):`);
  for (const problem of found) console.log(`    ${problem.file}\n      ${problem.detail}`);
}

if (problems.length === 0) console.log("[audit-docs] no problems found");
else {
  console.log(`\n[audit-docs] ${problems.length} problem(s)`);
  process.exit(1);
}
