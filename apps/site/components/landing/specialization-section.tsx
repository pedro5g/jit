import { CodePanel } from "@/components/code/code-panel";
import { GeneratedBadge } from "@/components/code/generated-badge";
import { Section, SectionHeading } from "@/components/ui/section";

const genericPath = `// generic library — every call, every field:
function check(schema, value) {
  for (const key of Object.keys(schema.shape)) {
    const rule = schema.shape[key];
    switch (rule.type) {           // dispatch per type
      case "string": /* … */ break;
      case "number": /* … */ break;
      // …walk nested schemas, allocate
      // issue objects, repeat next call
    }
  }
}`;

const jitPath = `// jit — compiled once for this exact shape:
function is(value) {
  let v3 = value.id;
  if (typeof v3 !== "number") return false;
  if (!Number.isInteger(v3)) return false;
  if (v3 <= 0) return false;
  let v5 = value.name;
  if (typeof v5 !== "string") return false;
  if (v5.length < 2) return false;
  // static keys, cheapest checks first,
  // early returns, zero allocation
  return true;
}`;

export function SpecializationSection() {
  return (
    <Section id="why-specialization">
      <SectionHeading
        eyebrow="Why specialization"
        title="Interpreting a schema on every call is the tax you never audited"
        lead="Generic libraries walk the schema tree, branch on types and allocate intermediates for each value they touch. jit walks the schema once — at compile time — and emits the straight-line code a performance engineer would write by hand."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <CodePanel code={genericPath} lang="js" title="generic path — interpreted per call" />
          <p className="mt-3 text-sm leading-relaxed text-fg-subtle">
            Dynamic dispatch, generic loops and issue allocation on the hot path, repeated for every value.
          </p>
        </div>
        <div>
          <CodePanel code={jitPath} lang="js" title="jit path — specialized" badge={<GeneratedBadge />} />
          <p className="mt-3 text-sm leading-relaxed text-fg-subtle">
            Static property access, checks ordered cheapest-first (typeof → null → numeric → length → regex), classic
            indexed loops, no closures.
          </p>
        </div>
      </div>
    </Section>
  );
}
