import { runSuite } from "../shared/persist.js";
import { registerSerializeScenarios } from "./scenarios.js";

registerSerializeScenarios();

await runSuite("serialize");
