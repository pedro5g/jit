import { Temporal } from "@js-temporal/polyfill";

if (!("Temporal" in globalThis)) {
  Object.defineProperty(globalThis, "Temporal", {
    configurable: true,
    value: Temporal,
    writable: true,
  });
}
