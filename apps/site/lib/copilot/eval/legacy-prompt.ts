/**
 * Frozen prompt for configuration A of the headless benchmark.
 *
 * This is deliberately not part of the product. It preserves the old
 * assistant's no-understanding/default turn after the graph implementation is
 * removed, so A/B continues to measure the pipeline change instead of a
 * memory of it.
 */
import type { ApiMember, RetrievedSection } from "../../assistant/types";

const FACTS = `What jit is, always true:
- jit walks a schema once at compile time and emits specialized straight-line JavaScript for each operation. It never interprets a schema at call time.
- Two execution modes, same generated code: runtime JIT compiles on first use through globalThis.Function; AOT emits an import-free module at build time.
- Every capability is reached through one namespace. There are no root aliases.
- If a name is not in the API list, it does not exist.`;

const RULES = `You are the jit ghost, the guide inside the jit documentation. jit is a compiled data engine for TypeScript.

Hard rules, in order:
1. Answer ONLY from the DOCUMENTATION SECTIONS below. They are the truth.
2. Use ONLY names from the API list below.
3. If the sections do not answer the question, say exactly that and do not fill the gap.
4. Never state a number, option name, or config key absent from the sections.

Lead with the answer. Cite as [1], [2]. Use at most one complete TypeScript code block. Reply in the reader's language.`;

const MAX_CONTEXT_CHARS = 5_200;

export function legacySystemPrompt(api: ApiMember[]): string {
  const listing = api.map((member) =>
    member.purpose ? `JIT.${member.name} — ${member.purpose}` : `JIT.${member.name}`
  );
  return `${RULES}\n\n${FACTS}\n\nThe complete public API. Never use a name outside this list:\n${listing.join("\n")}`;
}

function contextBlock(sections: RetrievedSection[]): string {
  const entries: string[] = [];
  let remaining = MAX_CONTEXT_CHARS;

  for (const [index, source] of sections.entries()) {
    const section = source.section;
    const warning = section.showsRemovedApis ? " — WARNING: quotes APIs removed in 2.0." : "";
    const header = `[${index + 1}] ${section.page} — ${section.heading} (${section.url})${warning}`;
    const entry = `${header}\n${section.text}`;
    if (entry.length > remaining) break;
    entries.push(entry);
    remaining -= entry.length;
  }

  return entries.join("\n\n");
}

export function legacyUserTurn(question: string, sections: RetrievedSection[]): string {
  return [
    `DOCUMENTATION SECTIONS:\n${contextBlock(sections) || "(none matched this question)"}`,
    `QUESTION: ${question}`,
  ].join("\n\n");
}
