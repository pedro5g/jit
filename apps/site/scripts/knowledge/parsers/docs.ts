/**
 * MDX in, sections out.
 *
 * A "section" is a heading and everything under it until the next heading of
 * the same or a higher level. That is the unit because it is the smallest
 * thing that answers a question on its own — a page covers six subjects, a
 * paragraph covers none.
 *
 * The parser is deliberately not a real MDX parser. It needs four things
 * (frontmatter, headings, code fences, prose) and a real parser would give it
 * an AST it would immediately flatten, at the cost of a dependency that has to
 * agree with the one Next uses to render the same file.
 */
import path from "node:path";

export interface Frontmatter {
  title?: string;
  description?: string;
  /** Comma-separated site paths, from `related:`. */
  related?: string;
  [key: string]: string | undefined;
}

export interface ParsedSection {
  /** Heading text, or the page title for the intro section. */
  heading: string;
  /** `page › parent heading › heading`. */
  breadcrumb: string;
  /** Heading level: 2, 3 or 4. The page title counts as 0. */
  depth: number;
  /** The anchor fumadocs derives from the heading, absent for the intro. */
  anchor?: string;
  /** Prose with MDX reduced away, code fences intact. */
  text: string;
  /** Fenced code blocks, kept separately so examples can be verified. */
  code: { lang: string; source: string }[];
  /** Documentation links present in this section, before MDX is flattened. */
  references: string[];
  /** Explicit explanatory labels such as bold mechanism names in a list. */
  concepts: string[];
  /** The section is mostly a table. */
  dense: boolean;
}

export interface ParsedDocument {
  frontmatter: Frontmatter;
  title: string;
  sections: ParsedSection[];
}

export function parseFrontmatter(source: string): { data: Frontmatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { data: {}, body: source };

  const data: Frontmatter = {};
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

/** Matches the anchor ids fumadocs derives from heading text. */
export function anchorFor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Reduces MDX to the prose a reader sees, keeping code fences intact.
 *
 * A code block is very often the answer, and its identifiers are what a
 * question matches — stripping them would leave the reference pages as lists
 * of headings with nothing under them.
 */
export function toPlainText(markdown: string): { text: string; code: { lang: string; source: string }[] } {
  const blocks: { lang: string; source: string }[] = [];

  const withoutCode = markdown.replace(/```([a-z]*)[^\n]*\n([\s\S]*?)```/gi, (_match, lang: string, source: string) => {
    blocks.push({ lang: lang || "text", source: source.trim() });
    return `@@CODE${blocks.length - 1}@@`;
  });

  const prose = withoutCode
    .replace(/^import .*$/gm, "")
    // JSX wrappers carry no prose a reader reads; their children already do
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

  return {
    text: prose.replace(/@@CODE(\d+)@@/g, (_match, index: string) => blocks[Number(index)]?.source ?? ""),
    code: blocks,
  };
}

export function parseDocument(relativeFile: string, source: string): ParsedDocument {
  const { data, body } = parseFrontmatter(source);
  const title = data.title ?? path.basename(relativeFile, ".mdx");

  const sections: ParsedSection[] = [];
  const lines = body.split(/\r?\n/);

  let heading: string | null = null;
  let depth = 0;
  let buffer: string[] = [];
  let insideFence = false;
  /** Ancestor headings by depth, so a nested section knows what it is under. */
  const trail: string[] = [];

  const flush = () => {
    const raw = buffer.join("\n");
    buffer = [];

    const { text, code } = toPlainText(raw);
    if (!text.trim()) return;

    // A section that is mostly a table enumerates the surface in two words per
    // row: it matches nearly every question and answers almost none of them.
    const nonEmpty = raw.split(/\r?\n/).filter((line) => line.trim());
    const tableRows = nonEmpty.filter((line) => /^\s*\|.*\|\s*$/.test(line)).length;

    sections.push({
      heading: heading ?? title,
      breadcrumb: [title, ...trail.slice(2, depth + 1)].filter(Boolean).join(" › "),
      depth,
      ...(heading ? { anchor: anchorFor(heading) } : {}),
      text: text.trim(),
      code,
      references: [...raw.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
        .map((match) => match[1].trim())
        .filter((target) => target.startsWith("/") || target.startsWith("#")),
      concepts: [...raw.matchAll(/^\s*[-*]\s+\*\*([^*]+)\*\*/gm)].map((match) => match[1].replace(/[.:]+$/, "").trim()),
      dense: nonEmpty.length > 0 && tableRows / nonEmpty.length > 0.5,
    });
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) insideFence = !insideFence;

    const match = insideFence ? null : /^(#{2,4})\s+(.+?)\s*$/.exec(line);
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

  return { frontmatter: data, title, sections };
}
