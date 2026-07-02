import { run } from "mitata";
import { registerArrayScenarios } from "./array.js";
import { registerDeepObject } from "./deep.js";
import { registerEntityIndex } from "./large.js";
import { registerMediumObject } from "./medium.js";
import { registerSmallObject } from "./small.js";
import { registerWorstCase } from "./worst-case.js";

registerSmallObject();
registerMediumObject();
registerDeepObject();
registerArrayScenarios();
registerWorstCase();
registerEntityIndex();

await run();
