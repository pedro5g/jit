import { runSuite } from "../shared/persist.js";
import { registerDiagnosticsScenarios, registerValidateScenarios } from "./scenarios.js";

await registerValidateScenarios();
registerDiagnosticsScenarios();

await runSuite("validate");
