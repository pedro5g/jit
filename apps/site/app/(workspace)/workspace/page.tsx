import type { Metadata } from "next";
import { Workspace } from "@/components/workspace/workspace";

export const metadata: Metadata = {
  title: "Workspace",
  description:
    "Write a jit schema once, run every compiled operation against real values, and generate the import-free module a project ships — with the ghost reading, writing and explaining alongside you.",
};

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;

  return <Workspace initialMode={mode === "generate" ? "generate" : "run"} />;
}
