import { runSuite } from "../shared/persist.js";
import { registerArrayDiffs } from "./array.js";
import { registerCollectionDiffs } from "./collections.js";
import { registerObjectDiffs } from "./objects.js";

registerObjectDiffs();
registerArrayDiffs();
registerCollectionDiffs();

await runSuite("diff");
