import { runSuite } from "../shared/persist.js";
import { registerKeyedOps } from "./keyed.js";
import { registerSingleObjectOps } from "./single-object.js";

registerSingleObjectOps();
registerKeyedOps();

await runSuite("object-ops");
