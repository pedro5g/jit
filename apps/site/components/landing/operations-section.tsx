import { Section, SectionHeading } from "@/components/ui/section";

const operations = [
  { name: "validate", detail: "is / parse / safeParse with structured issues" },
  { name: "equal", detail: "schema-aware deep equality with strategies" },
  { name: "clone", detail: "static-literal deep clone" },
  { name: "diff", detail: "structural diff entries" },
  { name: "hash", detail: "inline FNV-1a — no JSON.stringify" },
  { name: "update", detail: "immutable surgical updates, no Proxy" },
  { name: "query", detail: "fused single-loop pipelines, no intermediates" },
  { name: "mapper", detail: "whitelist-by-construction DTO mapping" },
  { name: "transform", detail: "compiled field selection and operators" },
  { name: "mask", detail: "PII-safe copies for structured logs" },
  { name: "sanitize", detail: "XSS-stripped copies, fused into parse" },
  { name: "stringify", detail: "compiled JSON with static keys" },
  { name: "codec", detail: "versioned binary wire format v2" },
  { name: "stream", detail: "progressive validation across chunks" },
  { name: "rowset", detail: "binary rows for massive flat batches" },
];

export function OperationsSection() {
  return (
    <Section id="operations" className="bg-night-950/40" ghostState="observing" ghostLabel="so many ops to compile…">
      <SectionHeading
        eyebrow="Operations"
        title="One schema. Every operation compiled."
        lead="Each operation is its own emitter following the same codegen rules — you only pay for what you compile."
      />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {operations.map((op) => (
          <li
            key={op.name}
            className="group flex items-baseline gap-3 rounded-card border border-line-subtle bg-night-800 px-5 py-4 transition-colors hover:border-line-gold"
          >
            <span className="font-mono text-sm font-semibold text-gold-200">.{op.name}</span>
            <span className="text-sm leading-relaxed text-fg-muted">{op.detail}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
