import { runSuite } from "../shared/persist.js";
import { registerValidateScenarios } from "./scenarios.js";

registerValidateScenarios();

await runSuite("validate");
