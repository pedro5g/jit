/**
 * Reading tool calls out of a reply — §47's protocol, in one line each.
 *
 * The same reasoning as the action tags, for the same reason: a 0.8B asked for
 * a JSON tool call produces something JSON-shaped that fails to parse, and the
 * call is then lost entirely rather than merely wrong. `[[find:uuid]]` either
 * appears or does not.
 *
 * Every name is matched against the allowlist and an unknown one is dropped,
 * so the vocabulary the model can reach is exactly `TOOL_NAMES` — there is no
 * spelling of a tag that runs anything else.
 */
import { TOOL_NAMES, type ToolCall, type ToolName } from "../../core/entities/tool";

/**
 * The tag each tool answers to.
 *
 * Short words rather than the tool's own name: a small model writes `[[find:]]`
 * reliably and `[[searchKnowledge:]]` about half the time, and the mapping
 * costs nothing.
 */
const TAGS: Record<string, ToolName> = {
  find: "searchKnowledge",
  api: "lookupSymbol",
  docs: "getSymbolDocumentation",
  example: "getExamples",
  go: "navigate",
  show: "openSection",
};

/**
 * Which tags are *calls* rather than answers.
 *
 * `go` and `show` are both: mid-answer they resolve a route so the model can
 * check it exists, and in the final answer they are the actions the UI
 * performs. Only the first four make the service ask the model again — a
 * navigation tag is not a reason to spend another generation.
 */
const CALLS = new Set<ToolName>(["searchKnowledge", "lookupSymbol", "getSymbolDocumentation", "getExamples"]);

const TAG = /\[\[(find|api|docs|example):([^\]]{1,200})\]\]/g;

export function parseToolCalls(reply: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const seen = new Set<string>();

  for (const match of reply.matchAll(TAG)) {
    const name = TAGS[match[1] as keyof typeof TAGS];
    const input = (match[2] ?? "").trim();
    if (!name || !CALLS.has(name) || !input) continue;

    const key = `${name}:${input}`;
    if (seen.has(key)) continue;
    seen.add(key);

    calls.push({ name, input });
  }

  return calls;
}

/** Whether a name is one this build can run at all. */
export function isToolName(value: string): value is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(value);
}

/** Strips call tags from prose the reader will see. */
export function stripToolCalls(reply: string): string {
  return reply
    .replace(TAG, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
