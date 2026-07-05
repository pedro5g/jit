import { runSuite } from "../shared/persist.js";
import { registerStreamScenarios } from "./scenarios.js";

registerStreamScenarios();

await runSuite("stream");
