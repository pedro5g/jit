import { BenchmarksSection } from "@/components/landing/benchmarks-section";
import { CodegenSection } from "@/components/landing/codegen-section";
import { CompilationModesSection } from "@/components/landing/compilation-modes-section";
import { DxSection } from "@/components/landing/dx-section";
import { FinalCta } from "@/components/landing/final-cta";
import { Hero } from "@/components/landing/hero";
import { OperationsSection } from "@/components/landing/operations-section";
import { OptimizerSection } from "@/components/landing/optimizer-section";
import { ProofStrip } from "@/components/landing/proof-strip";
import { RuntimeSection } from "@/components/landing/runtime-section";
import { SpecializationSection } from "@/components/landing/specialization-section";
import { PixelDivider } from "@/components/ui/pixel-divider";

export default function HomePage() {
  return (
    <>
      <Hero />
      <ProofStrip />
      <SpecializationSection />
      <PixelDivider />
      <CodegenSection />
      <PixelDivider />
      <CompilationModesSection />
      <PixelDivider />
      <OperationsSection />
      <PixelDivider />
      <OptimizerSection />
      <PixelDivider />
      <BenchmarksSection />
      <PixelDivider />
      <DxSection />
      <PixelDivider />
      <RuntimeSection />
      <FinalCta />
    </>
  );
}
