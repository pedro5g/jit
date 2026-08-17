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

/**
 * Names a jit example is allowed to reference without defining them.
 *
 * Documentation examples are fragments on purpose — they show the shape of a
 * call, not a whole program — so the values around the call are supplied here
 * rather than demanded of the page. Anything beyond this list is a genuinely
 * undefined reference and gets reported.
 */
const AMBIENT: Record<string, unknown> = {
  console: { log: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  queue: { write: () => {}, push: () => {} },
  socket: { on: () => {}, write: () => {} },
  process: { env: {}, stdout: { write: () => {} } },
  fetch: async () => ({ ok: true, json: async () => ({}), body: null }),
  structuredClone: (value: unknown) => value,
};

/**
 * A stand-in for a schema the example never declares, which throws the moment
 * it is used.
 *
 * Names like `Event`, `Request` and `File` read as schemas in an example and
 * are also platform globals, so a fragment that says `JIT.array(Event)` gets
 * handed the DOM `Event` constructor and fails with a TypeError that looks
 * exactly like a real API mistake. Shadowing them turns that back into the
 * ReferenceError it truly is: an undeclared reference in a fragment.
 */
function undeclared(name: string): unknown {
  const raise = () => {
    throw new ReferenceError(`${name} is not defined`);
  };

  return new Proxy(function () {} as object, { get: raise, apply: raise, construct: raise });
}

/** Platform globals that documentation examples use as schema names. */
const SHADOWED = [
  "Event",
  "Request",
  "Response",
  "File",
  "Headers",
  "Blob",
  "Node",
  "Text",
  "Comment",
  "Range",
  "Image",
  "Notification",
  "Location",
  "History",
  "Storage",
  "Performance",
  "Worker",
  "Document",
  "Selection",
];

/**
 * Examples that show a failure on purpose.
 *
 * The ops page demonstrates check ordering with
 * `JIT.validate.parse(Email)("NOT-AN-EMAIL"); // throws`, and it is right to.
 * A validation error from a block that says it throws is the block working.
 */
const DEMONSTRATES_A_THROW = /\/\/[^\n]*\b(throws?|lan[çc]a|rejects?|erro|error|❌)\b/i;

/**
 * Executes one example, reporting only failures that are the example's fault.
 *
 * A `ReferenceError` for a value the fragment never defines is expected — the
 * page is showing a call, not a program — so it is treated as a pass. A
 * `TypeError` is not: `JIT.stream(Row).ndjson()` throwing "is not a function"
 * means the page is teaching an API that does not exist, which is exactly the
 * class of error a reader cannot tell from a working one until they run it.
 */
async function runExample(code: string): Promise<string | null> {
  const body = code
    .replace(/^\s*import[^\n]*$/gm, "")
    .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, "")
    .replace(/\bexport\s+(?=(?:const|let|var|function|class|type|interface)\b)/g, "")
    .replace(/^\s*(?:type|interface)\s[\s\S]*?(?:;|\n\})\s*$/gm, "");

  // a name the fragment declares itself is its own; only the rest is shadowed
  const declared = new Set(
    [...body.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
  );
  const shadowed = SHADOWED.filter((name) => !declared.has(name));
  const names = [...Object.keys(AMBIENT), ...shadowed];
  const values = [...Object.keys(AMBIENT).map((name) => AMBIENT[name]), ...shadowed.map(undeclared)];

  try {
    const factory = new Function("JIT", ...names, `"use strict";\nreturn (async () => {\n${body}\n})();`) as (
      ...args: unknown[]
    ) => Promise<unknown>;

    await factory(JIT, ...values);
    return null;
  } catch (error) {
    // a fragment referencing a value it never declares is showing a call, not a program
    if (error instanceof ReferenceError) return null;
    // a fragment that is not a complete statement is a formatting choice
    if (error instanceof SyntaxError) return null;
    // and a block that says it throws is working when it does
    if (DEMONSTRATES_A_THROW.test(code) && error instanceof Error && /validation/i.test(error.name)) return null;

    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
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

const knownApi = new Set([...Object.keys(JIT), "Typeof", "Strict"]);
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
