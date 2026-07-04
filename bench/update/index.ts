import { runSuite } from "../shared/persist.js";
import { registerArrayUpdates } from "./array.js";
import { registerCollectionUpdates } from "./collections.js";
import { registerObjectUpdates } from "./objects.js";

registerObjectUpdates();
registerArrayUpdates();
registerCollectionUpdates();

await runSuite("update");
