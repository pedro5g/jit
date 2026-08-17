import type { Metadata } from "next";
import { Workspace } from "@/components/workspace/workspace";

export const metadata: Metadata = {
  title: "Lab",
  description:
    "Declare a whole schema layer as a file tree, compile it with the real AOT generator, and pull the result into a repository with one verified command.",
};

/**
 * The Lab is the project half of the workspace: a tree of files, the generator,
 * and the artifact. Its files import from `@jit-compiler/jit/define`, which is
 * the entrypoint the generator reads.
 */
export default function LabPage() {
  return <Workspace initialMode="generate" />;
}
