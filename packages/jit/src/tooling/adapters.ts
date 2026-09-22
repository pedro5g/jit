import type { AgentToolCore, JsonValue, ToolContext, ToolContract, ToolPayload } from "./contracts.js";

/** Host policy used by browser and Lab adapters before executing a write tool. */
export interface ToolHostPolicy {
  readonly allowWrite?: boolean;
}

/** A WebMCP-shaped registration that carries the shared tool contract. */
export interface WebMcpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonValue;
  readonly outputSchema: JsonValue;
  readonly mode: ToolContract["mode"];
  execute(input: JsonValue): Promise<ToolPayload>;
}

/** Adapts AgentToolCore to browser WebMCP registration without compiler logic. */
export function createWebMcpTools(
  core: AgentToolCore,
  context: ToolContext,
  policy: ToolHostPolicy = {}
): readonly WebMcpTool[] {
  return Object.freeze(core.list().map((contract) => adapt(contract, core, context, policy)));
}

/** Lab uses the same adapter shape so browser previews cannot drift from MCP. */
export function createLabTools(
  core: AgentToolCore,
  context: ToolContext,
  policy: ToolHostPolicy = {}
): readonly WebMcpTool[] {
  return createWebMcpTools(core, context, policy);
}

function adapt(contract: ToolContract, core: AgentToolCore, context: ToolContext, policy: ToolHostPolicy): WebMcpTool {
  return {
    name: contract.name,
    description: contract.description,
    inputSchema: contract.inputSchema,
    outputSchema: contract.outputSchema,
    mode: contract.mode,
    execute: async (input) => {
      if (contract.mode === "write" && policy.allowWrite !== true) {
        throw new Error(`Tool ${contract.name} is write-scoped and the host policy denied writes.`);
      }
      return core.execute(contract.name, input, context);
    },
  };
}
