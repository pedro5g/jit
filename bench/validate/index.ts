import { runSuite } from "../shared/persist.js";
import { registerDiagnosticsScenarios, registerValidateScenarios } from "./scenarios.js";

await registerValidateScenarios();
await registerDiagnosticsScenarios();

await runSuite("validate");
