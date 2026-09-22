/** JSON value accepted by transport adapters without a JIT runtime object. */
export type JsonPrimitive = string | number | boolean | null;
/** Recursive JSON value accepted by transport adapters. */
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** The transport-neutral result returned by an agent tool. */
export interface ToolPayload {
  /** Human-readable result text for a transport. */
  readonly text: string;
  /** Structured result data. */
  readonly data: JsonValue;
}

/** Structural result schema shared by every transport-neutral agent tool. */
export const TOOL_RESULT_SCHEMA: JsonValue = {
  type: "object",
  properties: {
    text: { type: "string" },
    data: {},
  },
  required: ["text", "data"],
  additionalProperties: false,
};

/** Context supplied by MCP, WebMCP, Lab or a future local adapter. */
export interface ToolContext {
  /** Workspace root used to resolve project-scoped operations. */
  readonly root: string;
}

/** One stable, transport-neutral agent operation. */
export interface ToolContract<TInput = JsonValue, TOutput = ToolPayload> {
  /** Stable operation name exposed by the transport. */
  readonly name: string;
  /** Human-readable operation description. */
  readonly description: string;
  /** Safety class governing the operation's side effects. */
  readonly mode: "read" | "preview" | "write";
  /** JSON schema for the operation input. */
  readonly inputSchema: JsonValue;
  /** JSON schema for the operation output. */
  readonly outputSchema: JsonValue;
  /** Executes the operation in a transport-provided context. */
  execute(input: TInput, context: ToolContext): Promise<TOutput>;
}

/** Shared registry used by every agent transport adapter. */
export class AgentToolCore {
  /** Registered contracts keyed by their stable operation name. */
  readonly #contracts: ReadonlyMap<string, ToolContract<JsonValue, ToolPayload>>;

  constructor(contracts: readonly ToolContract<JsonValue, ToolPayload>[]) {
    const map = new Map<string, ToolContract<JsonValue, ToolPayload>>();
    for (const contract of contracts) {
      if (map.has(contract.name)) throw new Error(`Duplicate agent tool ${JSON.stringify(contract.name)}.`);
      map.set(contract.name, contract);
    }
    this.#contracts = map;
  }

  /** Returns stable descriptors for a transport to expose. */
  list(): readonly ToolContract<JsonValue, ToolPayload>[] {
    return Object.freeze([...this.#contracts.values()].sort((left, right) => compareText(left.name, right.name)));
  }

  /** Executes a registered operation without knowing its transport. */
  async execute(name: string, input: JsonValue, context: ToolContext): Promise<ToolPayload> {
    const contract = this.#contracts.get(name);
    if (!contract) throw new Error(`Unknown agent tool ${JSON.stringify(name)}.`);
    return contract.execute(input, context);
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
