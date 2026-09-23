import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = resolve(root, "baselines", "critical.json");
mkdirSync(resolve(root, "baselines"), { recursive: true });
const input = await readStdin();
if (input.trim().length === 0) throw new Error("baseline update requires JSON on stdin from perf:critical");
JSON.parse(input);
writeFileSync(output, `${input.trim()}\n`, "utf8");
console.log(`Promoted explicit performance baseline: ${output}`);

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
