"use client";

import { Play, Sparkles } from "lucide-react";
import Link from "next/link";
import { CopyButton } from "@/components/code/copy-button";
import { workspaceActionFor } from "@/lib/assistant/actions";
import type { RetrievedSection } from "@/lib/assistant/types";

/**
 * A small local model writes fenced code and bracketed citations, and nothing
 * else that needs rendering. Parsing exactly those two things keeps a markdown
 * library — and its bundle — out of the docs page.
 *
 * Blocks are keyed by where they start in the answer. A streaming answer only
 * grows at the end, so every block already rendered keeps its key and its DOM,
 * which is what stops a copy button from losing its "copied" state while the
 * next paragraph arrives.
 */
type Block =
  | { at: number; kind: "text"; value: string }
  | { at: number; kind: "code"; value: string; language: string };

export function parseAnswer(answer: string): Block[] {
  const blocks: Block[] = [];
  const pattern = /```([a-zA-Z0-9]*)\n?([\s\S]*?)(?:```|$)/g;
  let cursor = 0;

  for (const match of answer.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) blocks.push({ at: cursor, kind: "text", value: answer.slice(cursor, start) });
    blocks.push({ at: start, kind: "code", value: match[2] ?? "", language: match[1] || "ts" });
    cursor = start + match[0].length;
  }

  if (cursor < answer.length) blocks.push({ at: cursor, kind: "text", value: answer.slice(cursor) });
  return blocks.filter((block) => block.value.trim().length > 0);
}

/** Turns `[2]` into a link to the second source, leaving unknown numbers as text. */
function withCitations(text: string, sources: RetrievedSection[]) {
  let offset = 0;

  return text.split(/(\[\d+\])/g).map((part) => {
    const key = `${offset}:${part}`;
    offset += part.length;

    const match = /^\[(\d+)\]$/.exec(part);
    const source = match ? sources[Number(match[1]) - 1] : undefined;
    if (!source) return <span key={key}>{part}</span>;

    return (
      <Link
        key={key}
        href={source.section.url}
        title={`${source.section.page} — ${source.section.heading}`}
        className="mx-0.5 rounded-pixel bg-gold-200/15 px-1 font-mono text-[10px] text-gold-200 no-underline hover:bg-gold-200/25"
      >
        {part}
      </Link>
    );
  });
}

export function AssistantAnswer({
  content,
  sources,
  onRunCode,
}: {
  content: string;
  sources: RetrievedSection[];
  /** Opens a snippet in the workspace. */
  onRunCode?: (code: string, mode: "run" | "generate") => void;
}) {
  return (
    <div className="flex flex-col gap-2.5 text-sm leading-relaxed text-ghost-100">
      {parseAnswer(content).map((block) => {
        if (block.kind === "text") {
          return (
            <p key={block.at} className="whitespace-pre-wrap">
              {withCitations(block.value.trim(), sources)}
            </p>
          );
        }

        const code = block.value.trimEnd();
        const action = workspaceActionFor(code, block.language);
        const mode = action?.kind === "workspace" ? action.mode : "run";

        return (
          <figure key={block.at} className="overflow-hidden rounded-control border border-line-subtle bg-night-1000/70">
            <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed">
              <code>{code}</code>
            </pre>
            <figcaption className="flex items-center gap-1.5 border-t border-line-subtle px-2 py-1.5">
              {action && onRunCode && (
                <button
                  type="button"
                  onClick={() => onRunCode(code, mode)}
                  className="inline-flex items-center gap-1.5 rounded-control border border-line-gold/50 bg-gold-200/10 px-2 py-1 text-[11px] text-gold-200 transition-colors hover:bg-gold-200/20"
                >
                  <Play aria-hidden className="size-3" />
                  {action.label}
                </button>
              )}
              <span className="ml-auto">
                <CopyButton text={code} label="Copy this snippet" />
              </span>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

export function AssistantSources({ sources }: { sources: RetrievedSection[] }) {
  if (sources.length === 0) return null;

  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {sources.map((source, index) => (
        <li key={source.section.url + source.section.part}>
          <Link
            href={source.section.url}
            className="inline-flex items-center gap-1.5 rounded-pill border border-line-subtle px-2 py-0.5 text-[11px] text-fg-muted no-underline transition-colors hover:border-line-gold hover:text-gold-200"
          >
            <span className="font-mono text-[10px] text-gold-200">{index + 1}</span>
            <span className="max-w-52 truncate">{source.section.heading}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function FollowUps({ questions, onAsk }: { questions: string[]; onAsk: (question: string) => void }) {
  if (questions.length === 0) return null;

  return (
    <ul className="mt-2.5 flex flex-col gap-1">
      {questions.map((question) => (
        <li key={question}>
          <button
            type="button"
            onClick={() => onAsk(question)}
            className="inline-flex items-center gap-1.5 text-left text-[11px] text-fg-muted transition-colors hover:text-gold-200"
          >
            <Sparkles aria-hidden className="size-3 shrink-0 text-gold-200/60" />
            {question}
          </button>
        </li>
      ))}
    </ul>
  );
}
