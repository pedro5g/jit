import type { Metadata } from "next";
import { ArtifactLab } from "@/components/lab/artifact-lab";
import { Section, SectionHeading } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "Artifact Lab",
  description: "Write any JIT schema, compile exact TypeScript and create a signed reconstruction reference.",
};

export default function LabPage() {
  return (
    <Section ghostState="typing" ghostLabel="building an artifact…">
      <SectionHeading eyebrow="Lab" title="TypeScript to signed AOT" align="left" />
      <ArtifactLab />
    </Section>
  );
}
