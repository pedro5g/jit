import { fingerprint } from "./harness/measure.js";

console.log(JSON.stringify(fingerprint(), null, 2));
