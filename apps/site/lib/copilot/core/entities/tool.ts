/**
 * What the copilot is allowed to do besides answer — §46 and §81.
 *
 * A closed list of six, every one of them a read over the artifacts the site
 * already ships. No tool takes a URL, a selector, a function or a query
 * language; each takes a string the registry parses, and a tool whose input
 * does not parse simply does not run. That is the whole security model, and it
 * is small enough to hold in your head, which is the point — §81 is not a
 * feature to be implemented but a surface to be kept from existing.
 */
export const TOOL_NAMES = [
  "searchKnowledge",
  "lookupSymbol",
  "getSymbolDocumentation",
  "getExamples",
  "navigate",
  "openSection",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolCall {
  name: ToolName;
  /** The raw argument, exactly as the model wrote it. Parsed by the tool. */
  input: string;
}

export interface ToolResult {
  call: ToolCall;
  /** What goes back into the conversation. Empty when the tool found nothing. */
  output: string;
  /** True when the tool ran and found something worth showing. */
  hit: boolean;
}

/**
 * How many tool calls one request may make — §48.
 *
 * The domain is one library's documentation. A question that cannot be
 * answered in four lookups is not going to be answered in fourteen; it is a
 * model in a loop, and the reader is watching a spinner while it happens.
 */
export const MAX_TOOL_CALLS = 4;
