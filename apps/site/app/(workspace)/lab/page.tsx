import type { Metadata } from "next";
import { ArtifactLab } from "@/components/lab/artifact-lab";

export const metadata: Metadata = {
  title: "Artifact Lab",
  description: "Write JIT schemas, inspect exact AOT output and create a signed reconstruction reference.",
};

export default function LabPage() {
  return <ArtifactLab />;
}
