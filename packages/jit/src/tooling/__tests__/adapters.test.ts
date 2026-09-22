import { createLabTools, createWebMcpTools } from "../adapters.js";
import { createAgentToolCore } from "../agent-tool-core.js";

describe("agent transport adapters", () => {
  it("exposes the same tool contracts to WebMCP and Lab", () => {
    const core = createAgentToolCore();
    const web = createWebMcpTools(core, { root: "." });
    const lab = createLabTools(core, { root: "." });

    expect(web.map((tool) => tool.name)).toEqual(lab.map((tool) => tool.name));
    expect(web.every((tool) => typeof tool.execute === "function")).toBe(true);
  });

  it("requires an explicit host policy for writes", async () => {
    const core = createAgentToolCore();
    const tools = createWebMcpTools(core, { root: "." });
    const apply = tools.find((tool) => tool.name === "jit_model_apply");

    await expect(apply?.execute({ baseRevision: "R0", operations: [] })).rejects.toThrow(/denied writes/);
  });
});
