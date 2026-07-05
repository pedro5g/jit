import { runSuite } from "../shared/persist.js";
import { registerValidateScenarios } from "./scenarios.js";

await registerValidateScenarios();

await runSuite("validate");
