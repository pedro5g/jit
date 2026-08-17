// Builds the retrieval index the ghost assistant answers from: every MDX page
// under content/docs is split at its headings into self-contained sections,
// stripped of MDX syntax, and written as one JSON document served statically.
// Run from apps/site (wired into the dev/build scripts). Output is gitignored.
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const siteDir = process.cwd();
const contentDir = path.join(siteDir, "content/docs");
const outFile = path.join(siteDir, "public/assistant/docs-index.json");

/** Sections longer than this are split again at paragraph boundaries. */
const MAX_SECTION_CHARS = 1400;
/** A tail shorter than this is folded back into the previous piece. */
const MIN_SECTION_CHARS = 220;

async function collect(dir, files) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) await collect(abs, files);
    else if (entry.name.endsWith(".mdx")) files.push(abs);
  }
  return files;
}

function parseFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { data: {}, body: source };

  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^["'](.*)["']$/, "$1");
    if (key) data[key] = value;
  }

  return { data, body: source.slice(match[0].length) };
}

/**
 * Pages whose subject is what changed, not what the library does.
 *
 * They are written in exactly the vocabulary of every conceptual question —
 * "Faster compilation and faster safeParse" is a heading — and their sections
 * are short, which BM25's length normalization rewards. So the changelog won
 * first place for "why is jit fast" and "how does safeParse work", and an
 * answer built on release notes reads like one: it describes a delta to
 * someone who has never seen the thing the delta applies to.
 *
 * They are still the right answer when the question is about a version or a
 * migration, so they are ranked down rather than dropped.
 */
const HISTORICAL_PAGES = ["/docs/whats-new", "/docs/guides/migrating-to-2"];

/** What a section is for, which decides how it is allowed to rank. */
function kindFor(url) {
  if (HISTORICAL_PAGES.some((page) => url === page || url.startsWith(`${page}#`))) return "history";
  if (url.startsWith("/docs/reference/")) return "reference";
  if (url.startsWith("/docs/concepts/")) return "concept";
  if (url.startsWith("/docs/guides/")) return "guide";
  if (url.startsWith("/docs/aot/")) return "aot";
  if (url.startsWith("/docs/runtime/")) return "runtime";
  return "overview";
}

/** `content/docs/guides/mcp-server.mdx` -> `/docs/guides/mcp-server`. */
function urlFor(file) {
  const relative = path.relative(contentDir, file).replaceAll(path.sep, "/");
  const withoutExtension = relative.replace(/\.mdx$/, "");
  const slug = withoutExtension.replace(/(^|\/)index$/, "");
  return slug ? `/docs/${slug}` : "/docs";
}

/** Matches the anchor ids fumadocs derives from heading text. */
function slugify(heading) {
  return heading
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Reduces MDX to the prose a reader sees, keeping code fences intact — a code
 * block is often the answer, and its identifiers are what a question matches.
 */
function toPlainText(markdown) {
  const blocks = [];
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, (block) => {
    blocks.push(block.replace(/```[a-z]*\n?/gi, "").trim());
    return `@@${blocks.length - 1}@@`;
  });

  const prose = withoutCode
    .replace(/^import .*$/gm, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*\|.*\|\s*$/gm, (row) =>
      row
        .split("|")
        .map((cell) => cell.trim())
        .filter((cell) => cell && !/^-+$/.test(cell))
        .join(" — ")
    )
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
    .replace(/\r?\n{3,}/g, "\n\n")
    .trim();

  return prose.replace(/@@(\d+)@@/g, (_, index) => blocks[Number(index)] ?? "");
}

/** Splits an over-long section at paragraph boundaries, never mid-sentence. */
function splitLongText(text) {
  if (text.length <= MAX_SECTION_CHARS) return [text];

  const pieces = [];
  let current = "";
  for (const paragraph of text.split(/\n{2,}/)) {
    if (current && current.length + paragraph.length > MAX_SECTION_CHARS) {
      pieces.push(current.trim());
      current = "";
    }
    current += `${paragraph}\n\n`;
  }
  if (current.trim()) pieces.push(current.trim());

  // a short tail carries no meaning on its own
  if (pieces.length > 1 && pieces[pieces.length - 1].length < MIN_SECTION_CHARS) {
    const tail = pieces.pop();
    pieces[pieces.length - 1] += `\n\n${tail}`;
  }

  return pieces;
}

/**
 * Symbolic links between related pages, declared in frontmatter:
 *
 *   related: /docs/runtime/queries, /docs/runtime/binary-rowsets
 *
 * The concept graph already derives most of these from its own edges, but it
 * only knows about relationships between *concepts*. A page-to-page link that
 * no concept expresses — the boundary guide belonging next to the DTO
 * reference — has nowhere else to live, and a reader who reaches one of them
 * almost always wants the other. `audit-docs` verifies every target exists.
 */
function relatedFrom(data) {
  if (!data.related) return [];

  return data.related
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("/"));
}

function sectionsFor(file, source) {
  const { data, body } = parseFrontmatter(source);
  const url = urlFor(file);
  const title = data.title ?? path.basename(file, ".mdx");
  const sections = [];

  // headings split the page; everything before the first one is the intro
  const lines = body.split(/\r?\n/);
  let heading = null;
  let depth = 0;
  let buffer = [];
  let insideCodeFence = false;
  /** Ancestor headings by depth, so a nested section knows what it is under. */
  const trail = [];
  const kind = kindFor(url);
  const related = relatedFrom(data);

  const flush = () => {
    const raw = buffer.join("\n");
    const text = toPlainText(raw).trim();
    buffer = [];
    if (!text) return;

    // A section that is mostly a markdown table is an enumeration, not an
    // explanation: it names every API in two words each, so it matches almost
    // any question and answers almost none of them. Left alone,
    // "compiled-operations" outranks the clone reference for "deep clone an
    // object fast", and the model is handed a row where it needed a page.
    const lines = raw.split(/\r?\n/).filter((line) => line.trim());
    const tableRows = lines.filter((line) => /^\s*\|.*\|\s*$/.test(line)).length;
    const dense = lines.length > 0 && tableRows / lines.length > 0.5;

    // "Performance" means nothing on its own — a dozen pages have that
    // heading. "equal › Performance" is a different subject from
    // "dto › Performance", and the trail is what tells them apart, both to
    // the ranking and to the model reading the section back.
    const breadcrumb = [title, ...trail.slice(2, depth + 1)].filter(Boolean).join(" › ");

    for (const [index, piece] of splitLongText(text).entries()) {
      sections.push({
        url: heading ? `${url}#${slugify(heading)}` : url,
        page: title,
        description: data.description ?? "",
        heading: heading ?? title,
        breadcrumb,
        kind,
        ...(related.length > 0 ? { related } : {}),
        ...(dense ? { dense: true } : {}),
        depth,
        part: index,
        text: piece,
      });
    }
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) insideCodeFence = !insideCodeFence;

    const match = !insideCodeFence && /^(#{2,4})\s+(.+?)\s*$/.exec(line);
    if (match) {
      flush();
      depth = match[1].length;
      heading = match[2].replace(/`/g, "").trim();
      trail[depth] = heading;
      trail.length = depth + 1;
      continue;
    }

    buffer.push(line);
  }
  flush();

  return sections;
}

/**
 * Every public `JIT.*` member, read from the reference index the site test
 * suite already compares against `Object.keys(JIT)`. Carrying this list in the
 * prompt is what stops a small model inventing an API name: it never has to
 * guess whether the mapper is `JIT.map` or `JIT.mapper`, because the real
 * surface is in front of it whether retrieval surfaced that page or not.
 */
function extractApiSurface(source) {
  const api = [];
  const seen = new Set();
  // The factory tables put two members on one row, so the optional purpose
  // cell must refuse a cell that is itself a member — otherwise it swallows
  // the next `JIT.x` and that member never gets a match of its own.
  const pattern = /`JIT\.([A-Za-z0-9_]+)`\s*\|\s*\[[^\]]+\]\(\.\/([^)]+)\)(?:\s*\|\s*(?!\s*`JIT\.)([^|\n]+))?/g;

  for (const match of source.matchAll(pattern)) {
    const [, name, target, purpose] = match;
    if (!name || seen.has(name)) continue;

    seen.add(name);
    api.push({
      name,
      url: `/docs/reference/functions/${target.replace(/#.*$/, "")}`,
      purpose: (purpose ?? "").replace(/`/g, "").trim(),
    });
  }

  return api;
}

const files = (await collect(contentDir, [])).sort();
const documents = [];

for (const file of files) {
  documents.push(...sectionsFor(file, await fs.readFile(file, "utf8")));
}

/**
 * Sections that quote APIs the library no longer has.
 *
 * The migration guide is full of them by design — its whole job is showing
 * `JIT.validator` next to what replaced it — and once a section is chunked,
 * the "// 1.x" comment that framed the block may not travel with it. A model
 * reading the fragment sees a removed name presented as ordinary code and
 * writes it back out. Marking the section lets the prompt say what it is.
 */
function marksRemovedApis(text, known) {
  for (const match of text.matchAll(/\bJIT\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    const name = match[1];
    // type-level exports are real but absent from the runtime namespace
    if (!known.has(name) && name !== "Typeof" && name !== "Strict") return true;
  }

  return false;
}

const apiSurface = extractApiSurface(
  await fs.readFile(path.join(contentDir, "reference/functions/index.mdx"), "utf8")
);

if (apiSurface.length === 0) {
  console.error("[docs-index] the API reference index yielded no members — refusing to ship a prompt without it");
  process.exit(1);
}

const knownApi = new Set(apiSurface.map((member) => member.name));
let legacySections = 0;

for (const section of documents) {
  if (marksRemovedApis(section.text, knownApi)) {
    section.showsRemovedApis = true;
    legacySections += 1;
  }
}

/**
 * Every method name the documentation actually calls.
 *
 * The audit needs to tell an invented method from a real one, and the schema
 * builder is only part of the answer: a compiled artifact has its own surface
 * (`.plan`, `.explain`, `.compile`, `.to.iterator()`), and so do the values
 * these examples are built from. Anything the docs call is real by definition,
 * which makes this the cheapest correct allowlist available — and one that
 * cannot fall behind, because it is rebuilt from the docs every time.
 */
function methodsCalledInDocs(sections) {
  const methods = new Set();

  for (const section of sections) {
    for (const match of section.text.matchAll(/\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) methods.add(match[1]);
  }

  return [...methods].sort();
}

const payload = {
  // the digest lets the browser invalidate cached embeddings when docs change
  version: createHash("sha256")
    .update(documents.map((section) => `${section.url}@@${section.text}`).join(""))
    .digest("hex")
    .slice(0, 16),
  builtAt: new Date().toISOString(),
  api: apiSurface,
  methodsInDocs: methodsCalledInDocs(documents),
  documents,
};

if (documents.length === 0) {
  console.error("[docs-index] no sections found under content/docs — refusing to write an empty index");
  process.exit(1);
}

await fs.mkdir(path.dirname(outFile), { recursive: true });
await fs.writeFile(outFile, JSON.stringify(payload));

const bytes = (await fs.stat(outFile)).size;
console.log(
  `[docs-index] ${documents.length} sections (${legacySections} quoting removed APIs) from ${files.length} pages, ${apiSurface.length} API members -> public/assistant/docs-index.json (${(bytes / 1024).toFixed(0)} KB, version ${payload.version})`
);
