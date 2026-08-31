/**
 * Frozen data shape for configuration A of the headless benchmark.
 *
 * The product no longer imports this module; the generated legacy docs index
 * and its BM25 baseline do. Keeping only their shared wire shape lets the A/B
 * comparison remain reproducible without retaining the old graph engine.
 */
export interface DocSection {
  url: string;
  page: string;
  description: string;
  heading: string;
  breadcrumb: string;
  kind: "history" | "reference" | "concept" | "guide" | "aot" | "runtime" | "overview";
  dense?: boolean;
  related?: string[];
  depth: number;
  part: number;
  showsRemovedApis?: boolean;
  text: string;
}

export interface ApiMember {
  name: string;
  url: string;
  purpose: string;
}

export interface DocsIndex {
  version: string;
  builtAt: string;
  api: ApiMember[];
  typeExports: string[];
  methodsInDocs: string[];
  documents: DocSection[];
}

export interface RetrievedSection {
  section: DocSection;
  score: number;
  lexical: number;
  semantic: number;
}
