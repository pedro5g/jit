import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const baseline = resolve(root, "baselines", "critical.json");

if (!existsSync(baseline)) {
  console.log("No performance baseline has been promoted yet; check skipped.");
} else {
  const value = JSON.parse(readFileSync(baseline, "utf8")) as { readonly scenarios?: readonly unknown[] };
  if (!Array.isArray(value.scenarios)) throw new Error("performance baseline has no scenarios");
  console.log(`Performance baseline is structurally valid (${value.scenarios.length} scenarios).`);
}
