import { runSuite } from "../shared/persist.js";
import { registerArrayClones } from "./array.js";
import { registerCollectionClones } from "./collections.js";
import { registerObjectClones } from "./objects.js";

registerObjectClones();
registerArrayClones();
registerCollectionClones();

await runSuite("clone");
