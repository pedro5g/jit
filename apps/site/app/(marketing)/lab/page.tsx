import type { Metadata } from "next";
import { ArtifactLab } from "@/components/lab/artifact-lab";
import { Section, SectionHeading } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "Artifact Lab",
  description: "Build typed JIT schemas, compile exact TypeScript and create byte-verifiable artifact tokens.",
};

export default function LabPage() {
  return (
    <Section ghostState="typing" ghostLabel="building an artifact…">
      <SectionHeading eyebrow="Lab" title="Schema to verified artifact" align="left" />
      <ArtifactLab />
    </Section>
  );
}
