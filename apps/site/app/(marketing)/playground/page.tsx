import type { Metadata } from "next";
import { PlaygroundClient } from "@/components/playground/playground-client";
import { Section, SectionHeading } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "Playground",
  description:
    "Compile jit schemas, lazy queries, watched collections and binary rowsets in your browser, then inspect the specialized source.",
};

export default function PlaygroundPage() {
  return (
    <Section ghostState="typing" ghostLabel="compiling your schema…">
      <SectionHeading
        eyebrow="Playground"
        title="The whole engine, in your browser"
        lead="A real TypeScript editor with full jit type inference for schemas, lazy pipelines, watched collections and binary data. Customize the inputs, run locally, and inspect the exact specialized source the compiler emits."
      />
      <PlaygroundClient />
    </Section>
  );
}
