import { runSuite } from "../shared/persist.js";
import { registerQueryScenarios } from "./scenarios.js";

registerQueryScenarios();

await runSuite("query");
