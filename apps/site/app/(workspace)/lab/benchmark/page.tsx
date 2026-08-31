import type { Metadata } from "next";
import { CopilotBenchmarkRunner } from "@/components/benchmark/copilot-benchmark-runner";

export const metadata: Metadata = {
  title: "Browser benchmark",
  description: "Runs the copilot case set against the model this site actually ships, in the runtime a reader is in.",
  robots: { index: false, follow: false },
};

/**
 * Not linked from navigation, and that is the design — §PART 26.
 *
 * A reader has no use for a page that downloads a gigabyte to answer thirty
 * questions they did not ask. It exists so the light tier can be measured
 * where it runs, because `onnxruntime-node` cannot load it at all.
 */
export default function BrowserBenchmarkPage() {
  return <CopilotBenchmarkRunner />;
}
