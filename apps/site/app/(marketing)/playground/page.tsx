import type { Metadata } from "next";
import { PlaygroundClient } from "@/components/playground/playground-client";
import { Section, SectionHeading } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "Playground",
  description:
    "Compile jit schemas in your browser: write a schema, validate JSON input and read the generated specialized source — everything runs locally in a Web Worker.",
};

export default function PlaygroundPage() {
  return (
    <Section ghostState="typing" ghostLabel="compiling your schema…">
      <SectionHeading
        eyebrow="Playground"
        title="Compile a schema, read the generated code"
        lead="The same engine that runs in Node runs here, in a Web Worker in your browser. Define a schema, feed it JSON, and inspect the exact specialized function jit emits."
      />
      <PlaygroundClient />
    </Section>
  );
}
