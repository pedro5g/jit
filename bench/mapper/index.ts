import { runSuite } from "../shared/persist.js";
import { registerMapperScenarios } from "./scenarios.js";

registerMapperScenarios();

await runSuite("mapper");
