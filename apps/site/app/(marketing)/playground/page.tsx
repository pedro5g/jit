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
        title="The whole engine, in your browser"
        lead="A real TypeScript editor with full jit type inference, every compiled operation one click away. Define a schema, customize the inputs, run it, and read the exact specialized source the compiler emits."
      />
      <PlaygroundClient />
    </Section>
  );
}
