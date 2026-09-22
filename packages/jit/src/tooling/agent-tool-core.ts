import { createArtifactToolCore } from "./artifact-tools.js";
import { AgentToolCore } from "./contracts.js";
import { createModelToolCore } from "./model-tools.js";

export type { JsonPrimitive, JsonValue, ToolContext, ToolContract, ToolPayload } from "./contracts.js";

/** Creates the transport-neutral v2 tool set shared by MCP, WebMCP and Lab. */
export function createAgentToolCore(): AgentToolCore {
  return new AgentToolCore([...createArtifactToolCore().list(), ...createModelToolCore().list()]);
}
