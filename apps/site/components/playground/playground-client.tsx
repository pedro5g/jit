"use client";

import Editor, { type Monaco } from "@monaco-editor/react";
import { Play, Share2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCopy } from "@/hooks/use-copy";
import type { PlaygroundOp, PlaygroundResponse } from "@/lib/playground/worker";

const RUN_TIMEOUT_MS = 2500;

const defaultCode = `import { JIT } from "@jit-compiler/jit/runtime";

const schema = JIT.object({
  id: JIT.number().int().positive(),
  name: JIT.string().min(2),
  email: JIT.string().email().pii("mask"),
  role: JIT.union(JIT.literal("admin"), JIT.literal("user")),
  tags: JIT.array(JIT.string()).max(8),
});

// full type inference — hover User:
type User = JIT.Typeof<typeof schema>;
`;

const adaInput = `{
  "id": 1,
  "name": "Ada",
  "email": "ada@lovelace.dev",
  "role": "admin",
  "tags": ["compiler"]
}`;

interface OpConfig {
  id: PlaygroundOp;
  label: string;
  aLabel?: string;
  needsB: false | { label: string; default: string };
  hasSource: boolean;
}

const usersArrayInput = `[
  { "id": 1, "name": "Ada", "email": "ada@lovelace.dev", "role": "admin", "tags": ["compiler"] },
  { "id": 2, "name": "Grace", "email": "grace@navy.mil", "role": "admin", "tags": ["cobol"] },
  { "id": 3, "name": "Barbara", "email": "barbara@mit.edu", "role": "user", "tags": [] }
]`;

const currentUsersArrayInput = `[
  { "id": 1, "name": "Ada Lovelace", "email": "ada@lovelace.dev", "role": "admin", "tags": ["compiler", "math"] },
  { "id": 3, "name": "Barbara", "email": "barbara@mit.edu", "role": "user", "tags": [] },
  { "id": 4, "name": "Alan", "email": "alan@bletchley.uk", "role": "user", "tags": ["cryptography"] }
]`;

const watchedListActionsInput = `[
  { "type": "remove", "item": { "id": 2, "name": "Grace", "role": "admin" } },
  { "type": "add", "item": { "id": 4, "name": "Alan", "role": "user" } }
]`;

const reorderedEntityUsersInput = `[
  { "id": 2, "name": "Grace", "role": "member" },
  { "id": 1, "name": "Ada", "role": "admin" }
]`;

const eventRowsInput = `[
  { "id": 1, "score": 42.5, "active": true, "region": "br" },
  { "id": 2, "score": 18.0, "active": false, "region": "us" },
  { "id": 3, "score": 91.5, "active": true, "region": "br" },
  { "id": 4, "score": 73.0, "active": true, "region": "eu" }
]`;

const ops: OpConfig[] = [
  { id: "validate", label: "validate", needsB: false, hasSource: true },
  { id: "parse", label: "parse", needsB: false, hasSource: true },
  { id: "equal", label: "equal", needsB: { label: "value B", default: adaInput }, hasSource: true },
  { id: "clone", label: "clone", needsB: false, hasSource: true },
  {
    id: "diff",
    label: "diff",
    needsB: {
      label: "value B",
      default: `{
  "id": 1,
  "name": "Ada L.",
  "email": "ada@lovelace.dev",
  "role": "admin",
  "tags": ["compiler", "math"]
}`,
    },
    hasSource: true,
  },
  { id: "hash", label: "hash", needsB: false, hasSource: true },
  { id: "update", label: "update", needsB: { label: "patch", default: `{ "name": "Grace" }` }, hasSource: false },
  {
    id: "reactiveUpdate",
    label: "reactive",
    needsB: { label: "patches", default: `[{ "profile": { "score": 2 } }]` },
    hasSource: false,
  },
  { id: "stringify", label: "stringify", needsB: false, hasSource: true },
  { id: "mask", label: "mask", needsB: false, hasSource: true },
  { id: "sanitize", label: "sanitize", needsB: false, hasSource: true },
  { id: "codec", label: "codec", needsB: false, hasSource: true },
  {
    id: "query",
    label: "query",
    aLabel: "rows (JSON array)",
    needsB: { label: "params (optional)", default: `{ "minimumId": 1 }` },
    hasSource: true,
  },
  { id: "lazy", label: "lazy", aLabel: "rows (JSON array)", needsB: false, hasSource: true },
  { id: "visitor", label: "visitor", aLabel: "rows (JSON array)", needsB: false, hasSource: true },
  {
    id: "watch",
    label: "watch",
    aLabel: "previous collection",
    needsB: { label: "current collection", default: currentUsersArrayInput },
    hasSource: true,
  },
  {
    id: "watchedList",
    label: "watchedList",
    aLabel: "initial collection",
    needsB: { label: "actions", default: watchedListActionsInput },
    hasSource: false,
  },
  { id: "binary", label: "binary", aLabel: "flat rows (JSON array)", needsB: false, hasSource: true },
  { id: "jsonChunks", label: "chunks", aLabel: "values (JSON array)", needsB: false, hasSource: true },
  { id: "transform", label: "transform", needsB: false, hasSource: true },
  { id: "mapper", label: "mapper", aLabel: "value or array (JSON)", needsB: false, hasSource: true },
  { id: "model", label: "model", needsB: false, hasSource: false },
  { id: "dto", label: "dto", aLabel: "entity or entities (JSON)", needsB: false, hasSource: false },
  {
    id: "indexes",
    label: "indexes",
    aLabel: "entity collection",
    needsB: { label: "reordered collection", default: reorderedEntityUsersInput },
    hasSource: true,
  },
];

const examples: { id: string; label: string; code: string; a: string; op: PlaygroundOp }[] = [
  { id: "user", label: "User validator", code: defaultCode, a: adaInput, op: "validate" },
  {
    id: "invalid",
    label: "Invalid input (issues)",
    code: defaultCode,
    a: `{
  "id": -3,
  "name": "A",
  "email": "not-an-email",
  "role": "root",
  "tags": [42]
}`,
    op: "validate",
  },
  {
    id: "coerce",
    label: "Coercion & defaults",
    code: `import { JIT } from "@jit-compiler/jit/runtime";

const schema = JIT.object({
  page: JIT.coerce.number().int().min(1).default(1),
  limit: JIT.coerce.number().int().max(100).default(20),
  search: JIT.string().trim().optional(),
});
`,
    a: `{ "page": "2", "limit": "50", "search": "  ghosts  " }`,
    op: "parse",
  },
  {
    id: "pii",
    label: "PII masking",
    code: defaultCode,
    a: adaInput,
    op: "mask",
  },
  {
    id: "sanitize",
    label: "Configurable sanitizer",
    code: `import { JIT } from "@jit-compiler/jit/runtime";

const schema = JIT.object({
  title: JIT.string().sanitize("text"),
  richText: JIT.string().sanitize({
    preset: "none",
    html: { mode: "allow", tags: ["b", "em", "code"] },
    controls: "remove",
  }),
  column: JIT.string().sanitize("sqlIdentifier"),
  uploadName: JIT.string().sanitize("pathSegment"),
});
`,
    a: `{
  "title": "<script>steal()</script><b>Hello</b>",
  "richText": "<b onclick='bad()'>Fast</b> <code>JIT</code><img src=x>",
  "column": "user.name; DROP",
  "uploadName": "../avatar?.png"
}`,
    op: "sanitize",
  },
  {
    id: "reactive-update",
    label: "Reactive immutable update",
    code: `import { JIT } from "@jit-compiler/jit/runtime";

const schema = JIT.object({
  id: JIT.number().int32(),
  name: JIT.string(),
  profile: JIT.object({ score: JIT.number(), active: JIT.boolean() }),
});

const reactiveUpdate = (initial: JIT.Typeof<typeof schema>, patches: unknown[]) => {
  const store = JIT.update(schema).reactive(initial);
  const events: unknown[] = [];

  store.watch(["profile", "score"], ({ previous, value }) => {
    events.push({ property: "profile.score", previous, value });
  });
  store.subscribe((event) => {
    events.push({ version: event.version, changes: event.changes });
  });
  store.batch((state) => {
    for (const patch of patches) state.update(patch as never);
  });

  return { value: store.value, version: store.version, events };
};
`,
    a: `{ "id": 1, "name": "Ada", "profile": { "score": 1, "active": true } }`,
    op: "reactiveUpdate",
  },
  {
    id: "codec",
    label: "Binary codec (wire v2)",
    code: defaultCode,
    a: adaInput,
    op: "codec",
  },
  {
    id: "query",
    label: "Query pipeline",
    code: `import { JIT } from "@jit-compiler/jit/runtime";

const schema = JIT.object({
  id: JIT.number().int().positive(),
  name: JIT.string().min(2),
  email: JIT.string().email(),
  role: JIT.union(JIT.literal("admin"), JIT.literal("user")),
  tags: JIT.array(JIT.string()).max(8),
});

// fused single-loop pipeline — no intermediate arrays
const query = JIT.query(JIT.array(schema))
  .params({ minimumId: JIT.int() })
  .filter((q, p) => q.and(q.eq("role", "admin"), q.gte("id", p.minimumId)))
  .select("id", "name", "role")
  .orderBy("name", "asc")
  .compile();
`,
    a: usersArrayInput,
    op: "query",
  },
  {
    id: "lazy",
    label: "Lazy generator",
    code: `import { JIT } from "@jit-compiler/jit/runtime";

const schema = JIT.object({
  id: JIT.number().int32(),
  score: JIT.number().float64(),
  active: JIT.boolean(),
  region: JIT.union(JIT.literal("br"), JIT.literal("us"), JIT.literal("eu")),
});

// Pull-based generator: filter/select/take fuse and stop after two matches.
const lazy = JIT.query(JIT.array(schema))
  .filter((q) => q.eq("active", true))
  .select("id", "score")
  .take(2)
  .lazy()
  .compile();
`,
    a: eventRowsInput,
    op: "lazy",
  },
  {
    id: "visitor",
    label: "Direct visitor",
    code: `import { JIT } from "@jit-compiler/jit/runtime";

const schema = JIT.object({
  id: JIT.number().int32(),
  score: JIT.number().float64(),
  active: JIT.boolean(),
  region: JIT.union(JIT.literal("br"), JIT.literal("us"), JIT.literal("eu")),
});

// Push-based sink: no iterator protocol and no result array in the engine.
const visitor = JIT.query(JIT.array(schema))
  .filter((q) => q.and(q.eq("active", true), q.gte("score", 40)))
  .select("id", "score")
  .compileVisitor();
`,
    a: eventRowsInput,
    op: "visitor",
  },
  {
    id: "watch",
    label: "Snapshot watcher",
    code: `import { JIT } from "@jit-compiler/jit/runtime";

const schema = JIT.object({
  id: JIT.number().int32(),
  name: JIT.string().min(2),
  email: JIT.string().email(),
  role: JIT.union(JIT.literal("admin"), JIT.literal("user")),
  tags: JIT.array(JIT.string()),
});
const Users = JIT.array(schema);

// Stateless O(n) diff specialized to direct item.id access.
const watch = JIT.watch(Users, { key: "id" });
`,
    a: usersArrayInput,
    op: "watch",
  },
  {
    id: "watched-list",
    label: "Stateful watched list",
    code: `import { JIT } from "@jit-compiler/jit/runtime";

const schema = JIT.object({
  id: JIT.number().int32(),
  name: JIT.string().min(2),
  role: JIT.union(JIT.literal("admin"), JIT.literal("user")),
});
const Users = JIT.array(schema);

// The playground applies the JSON actions and returns snapshot().
const watchedList = (initial: JIT.Typeof<typeof Users>) =>
  JIT.watchedList(Users, initial, { key: "id" });
`,
    a: `[
  { "id": 1, "name": "Ada", "role": "admin" },
  { "id": 2, "name": "Grace", "role": "admin" }
]`,
    op: "watchedList",
  },
  {
    id: "binary",
    label: "Columnar binary rowset",
    code: `import { JIT } from "@jit-compiler/jit/runtime";

const schema = JIT.object({
  id: JIT.number().int32(),
  score: JIT.number().float64(),
  active: JIT.boolean(),
  region: JIT.union(JIT.literal("br"), JIT.literal("us"), JIT.literal("eu")),
});

const binary = JIT.array(schema).binary({
  strategy: "exact",
  memoryLayout: "columnar",
});
const binaryQuery = JIT.query(binary)
  .filter((q) => q.and(q.eq("region", "br"), q.eq("active", true)))
  .select("id", "score")
  .compile();
`,
    a: eventRowsInput,
    op: "binary",
  },
  {
    id: "json-chunks",
    label: "Chunked JSON generator",
    code: `import { JIT } from "@jit-compiler/jit/runtime";

const Item = JIT.object({
  id: JIT.number().int32(),
  name: JIT.string(),
});
const schema = JIT.array(Item);

// Bounded output chunks can be written directly to a response or socket.
const stringifyChunks = JIT.json(schema)
  .stringifyChunks({ chunkBytes: 48 })
  .compile();
`,
    a: `[
  { "id": 1, "name": "Ada Lovelace" },
  { "id": 2, "name": "Grace Hopper" },
  { "id": 3, "name": "Barbara Liskov" }
]`,
    op: "jsonChunks",
  },
  {
    id: "mapper",
    label: "DTO mapper (no leaks)",
    code: `import { JIT } from "@jit-compiler/jit/runtime";

const schema = JIT.object({
  id: JIT.number().int(),
  fullName: JIT.string(),
  passwordHash: JIT.string(),
  profile: JIT.object({ age: JIT.number(), city: JIT.string() }),
});

const PublicUser = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
  label: JIT.string(),
});

// whitelist by construction — passwordHash cannot leak
const mapper = JIT.mapper(schema, PublicUser, {
  name: { from: "fullName" },
  label: (user) => user.fullName + "#" + user.id,
});
`,
    a: `{
  "id": 1,
  "fullName": "Ada Lovelace",
  "passwordHash": "$argon2id$…",
  "profile": { "age": 36, "city": "London" }
}`,
    op: "mapper",
  },
  {
    id: "model",
    label: "Explicit model operations",
    code: `import { JIT } from "@jit-compiler/jit/runtime";

const schema = JIT.object({
  id: JIT.number().int32().positive(),
  name: JIT.string().min(2),
  email: JIT.string().email(),
});

// Only these methods exist, compile, and enter the runtime bundle.
const model = JIT.model(schema, {
  is: true,
  parse: true,
  clone: true,
});
`,
    a: `{ "id": 1, "name": "Ada", "email": "ada@lovelace.dev" }`,
    op: "model",
  },
  {
    id: "dto",
    label: "DTO aggregate",
    code: `import { JIT } from "@jit-compiler/jit/runtime";

const schema = JIT.object({
  id: JIT.number().int32(),
  fullName: JIT.string(),
  passwordHash: JIT.string(),
  profile: JIT.object({ city: JIT.string(), internalScore: JIT.number() }),
});

const PublicUser = JIT.object({
  id: JIT.number().int32(),
  name: JIT.string(),
  city: JIT.string(),
});

const dto = JIT.dto(schema, PublicUser, {
  name: { from: "fullName" },
  city: (user) => user.profile.city,
}).get("is", "stringify", "from", "many");
`,
    a: `{
  "id": 1,
  "fullName": "Ada Lovelace",
  "passwordHash": "$argon2id$secret",
  "profile": { "city": "London", "internalScore": 99 }
}`,
    op: "dto",
  },
  {
    id: "indexes",
    label: "Entity, indexBy & keyed",
    code: `import { JIT } from "@jit-compiler/jit/runtime";

const schema = JIT.object({
  id: JIT.number().int32(),
  name: JIT.string(),
  role: JIT.string(),
});

const EntityUsers = JIT.array(schema).entity({ key: "id" });
const IndexedUsers = JIT.array(schema).indexBy("id");
const KeyedUsers = JIT.array(schema).keyed("id");

const indexes = {
  // entity alone keeps positional equality
  entityEqual: JIT.equal(EntityUsers).compile(),
  // indexBy/keyed match reordered entities by id
  indexedEqual: JIT.equal(IndexedUsers).compile(),
  keyedEqual: JIT.equal(KeyedUsers).compile(),
  // entity metadata supplies the default normalization key
  normalize: JIT.compileNormalize(EntityUsers.schema),
  // query keyed() is a fresh Map collector, not a retained schema index
  keyedQuery: JIT.query(JIT.array(schema)).keyed("id").select("name").compile(),
};
`,
    a: `[
  { "id": 1, "name": "Ada", "role": "admin" },
  { "id": 2, "name": "Grace", "role": "member" }
]`,
    op: "indexes",
  },
  {
    id: "transform",
    label: "Transform (select + map)",
    code: `import { JIT } from "@jit-compiler/jit/runtime";

const schema = JIT.object({
  id: JIT.number().int().positive(),
  name: JIT.string().min(2),
  email: JIT.string().email(),
  role: JIT.union(JIT.literal("admin"), JIT.literal("user")),
  tags: JIT.array(JIT.string()).max(8),
});

const transform = JIT.transform(schema)
  .select("id", "name")
  .map("name", (field) => field.lowercase())
  .compile();
`,
    a: `{ "id": 1, "name": "ADA LOVELACE", "email": "ada@lovelace.dev", "role": "admin", "tags": [] }`,
    op: "transform",
  },
];

type RunState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; response: PlaygroundResponse }
  | { status: "error"; message: string };

interface SharePayload {
  code: string;
  a: string;
  b: string;
  op: PlaygroundOp;
}

function encodeShare(payload: SharePayload): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}

function decodeShare(hash: string): SharePayload | null {
  try {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(hash))));
    if (typeof parsed.code === "string" && typeof parsed.a === "string") return parsed;
  } catch {
    // corrupt or foreign hash — fall back to defaults
  }
  return null;
}

const editorOptions = {
  minimap: { enabled: false },
  fontSize: 13,
  lineHeight: 21,
  scrollBeyondLastLine: false,
  padding: { top: 12, bottom: 12 },
  tabSize: 2,
  automaticLayout: true,
  wordWrap: "on",
  scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  renderLineHighlight: "none",
  overviewRulerLanes: 0,
  fixedOverflowWidgets: true,
} as const;

export function PlaygroundClient() {
  const [code, setCode] = useState(defaultCode);
  const [inputA, setInputA] = useState(adaInput);
  const [inputB, setInputB] = useState("");
  const [op, setOp] = useState<PlaygroundOp>("validate");
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const [tab, setTab] = useState<"result" | "source">("result");
  const [dts, setDts] = useState<Record<string, string> | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runId = useRef(0);
  const ranOnce = useRef(false);
  const editedB = useRef(false);
  const { copied, copyToClipboard } = useCopy();

  const opConfig = ops.find((item) => item.id === op) ?? ops[0];

  useEffect(() => {
    const shared = window.location.hash.startsWith("#code=")
      ? decodeShare(window.location.hash.slice("#code=".length))
      : null;
    if (shared) {
      setCode(shared.code);
      setInputA(shared.a);
      setInputB(shared.b ?? "");
      if (ops.some((item) => item.id === shared.op)) setOp(shared.op);
      editedB.current = true;
    }

    fetch("/playground/jit-dts.json")
      .then((response) => (response.ok ? response.json() : null))
      .then((manifest) => setDts(manifest?.files ?? {}))
      .catch(() => setDts({}));

    return () => {
      workerRef.current?.terminate();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const beforeMount = useCallback(
    (monaco: Monaco) => {
      monaco.editor.defineTheme("jit-night", {
        base: "vs-dark",
        inherit: true,
        rules: [
          { token: "keyword", foreground: "c69cff" },
          { token: "type.identifier", foreground: "7db7ff" },
          { token: "string", foreground: "9dd8a8" },
          { token: "number", foreground: "ffb86b" },
          { token: "comment", foreground: "6f777b" },
        ],
        colors: {
          "editor.background": "#121520",
          "editor.foreground": "#e8e2c5",
          "editorLineNumber.foreground": "#454d50",
          "editorLineNumber.activeForeground": "#777f82",
          "editorIndentGuide.background1": "#1d222b",
          "editorWidget.background": "#171b25",
          "editorSuggestWidget.background": "#171b25",
          "editorSuggestWidget.selectedBackground": "#23292f",
          "input.background": "#121520",
        },
      });

      const ts = monaco.languages.typescript;
      ts.typescriptDefaults.setCompilerOptions({
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        strict: true,
        esModuleInterop: true,
        allowNonTsExtensions: true,
      });
      ts.typescriptDefaults.setEagerModelSync(true);
      if (dts) {
        for (const [path, content] of Object.entries(dts)) {
          ts.typescriptDefaults.addExtraLib(content, `file:///node_modules/@jit-compiler/jit/${path}`);
        }
      }
    },
    [dts]
  );

  /** TS → JS via monaco's own TypeScript worker, so type aliases and generics run fine. */
  const transpile = useCallback(async (source: string): Promise<string> => {
    const monaco = monacoRef.current;
    if (!monaco) return source;
    try {
      const uri = monaco.Uri.parse("file:///playground/main.ts");
      const getWorker = await monaco.languages.typescript.getTypeScriptWorker();
      const client = await getWorker(uri);
      const output = await client.getEmitOutput(uri.toString());
      return output.outputFiles[0]?.text ?? source;
    } catch {
      return source; // plain-JS snippets still work — the worker strips imports
    }
  }, []);

  const execute = useCallback(
    async (request: { code: string; a: string; b: string; op: PlaygroundOp }) => {
      runId.current += 1;
      const id = runId.current;
      setRun({ status: "running" });

      const js = await transpile(request.code);

      if (!workerRef.current) {
        workerRef.current = new Worker(new URL("../../lib/playground/worker.ts", import.meta.url));
      }
      const worker = workerRef.current;

      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        worker.terminate();
        workerRef.current = null;
        setRun({ status: "error", message: `timed out after ${RUN_TIMEOUT_MS}ms — the worker was terminated` });
      }, RUN_TIMEOUT_MS);

      worker.onmessage = (event: MessageEvent<PlaygroundResponse>) => {
        if (event.data.id !== id) return;
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        ranOnce.current = true;
        setRun({ status: "done", response: event.data });
      };
      worker.onerror = () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        worker.terminate();
        workerRef.current = null;
        setRun({ status: "error", message: "the worker crashed — check your snippet for syntax errors" });
      };

      worker.postMessage({ id, code: js, op: request.op, inputA: request.a, inputB: request.b });
    },
    [transpile]
  );

  const selectOp = (next: OpConfig) => {
    setOp(next.id);
    let nextB = inputB;
    if (next.needsB && !editedB.current) {
      nextB = next.needsB.default;
      setInputB(nextB);
    }
    if (!next.hasSource) setTab("result");
    if (ranOnce.current) execute({ code, a: inputA, b: next.needsB ? nextB : "", op: next.id });
  };

  const response = run.status === "done" ? run.response : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="playground-example" className="text-xs text-fg-subtle">
          Example
        </label>
        <select
          id="playground-example"
          className="rounded-control border border-line-subtle bg-night-950 px-3 py-1.5 text-sm text-ghost-100"
          defaultValue="user"
          onChange={(event) => {
            const example = examples.find((item) => item.id === event.target.value);
            if (!example) return;
            setCode(example.code);
            setInputA(example.a);
            setInputB("");
            editedB.current = false;
            const config = ops.find((item) => item.id === example.op);
            if (config?.needsB) setInputB(config.needsB.default);
            setOp(example.op);
            setRun({ status: "idle" });
            ranOnce.current = false;
          }}
        >
          {examples.map((example) => (
            <option key={example.id} value={example.id}>
              {example.label}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const url = `${window.location.origin}/playground#code=${encodeShare({ code, a: inputA, b: inputB, op })}`;
              copyToClipboard(url);
            }}
            className="inline-flex items-center gap-1.5 rounded-control border border-line-subtle px-3 py-1.5 text-xs text-fg-muted hover:border-line hover:text-ghost-100"
          >
            <Share2 aria-hidden className="size-3.5" />
            {copied ? "URL copied!" : "Share"}
          </button>
          <button
            type="button"
            onClick={() => execute({ code, a: inputA, b: opConfig.needsB ? inputB : "", op })}
            disabled={run.status === "running"}
            className="inline-flex items-center gap-1.5 rounded-control bg-gold-200 px-4 py-1.5 text-xs font-semibold text-night-900 hover:bg-gold-100 disabled:opacity-60"
          >
            <Play aria-hidden className="size-3.5" />
            {run.status === "running" ? "Compiling…" : "Compile & run"}
          </button>
        </div>
      </div>

      <div role="tablist" aria-label="Operation" className="flex flex-wrap gap-1.5">
        {ops.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={op === item.id}
            onClick={() => selectOp(item)}
            className={
              op === item.id
                ? "rounded-control bg-gold-200 px-3 py-1.5 font-mono text-xs text-night-900"
                : "rounded-control border border-line-subtle px-3 py-1.5 font-mono text-xs text-fg-muted hover:border-line hover:text-ghost-100"
            }
          >
            .{item.label}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[7fr_5fr]">
        <div className="flex flex-col gap-4">
          <div className="overflow-hidden rounded-card border border-line-subtle">
            {dts ? (
              <Editor
                height="380px"
                path="file:///playground/main.ts"
                defaultLanguage="typescript"
                theme="jit-night"
                value={code}
                onChange={(value) => setCode(value ?? "")}
                beforeMount={beforeMount}
                onMount={(_editor, monaco) => {
                  monacoRef.current = monaco;
                }}
                options={editorOptions}
                loading={
                  <div className="flex h-95 w-full items-center justify-center bg-night-950 font-mono text-xs text-fg-subtle">
                    loading editor…
                  </div>
                }
              />
            ) : (
              <div className="flex h-95 w-full items-center justify-center bg-night-950 font-mono text-xs text-fg-subtle">
                loading jit type definitions…
              </div>
            )}
          </div>
          <div className={opConfig.needsB ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}>
            <div>
              <label htmlFor="playground-input-a" className="mb-1.5 block font-mono text-xs text-fg-subtle">
                {opConfig.aLabel ?? "input A (JSON)"}
              </label>
              <textarea
                id="playground-input-a"
                value={inputA}
                onChange={(event) => setInputA(event.target.value)}
                spellCheck={false}
                rows={7}
                className="w-full resize-y rounded-card border border-line-subtle bg-night-950 p-4 font-mono text-[13px] leading-relaxed text-ghost-100 focus-visible:outline-2 focus-visible:outline-gold-200"
              />
            </div>
            {opConfig.needsB && (
              <div>
                <label htmlFor="playground-input-b" className="mb-1.5 block font-mono text-xs text-fg-subtle">
                  {opConfig.needsB.label} (JSON)
                </label>
                <textarea
                  id="playground-input-b"
                  value={inputB}
                  onChange={(event) => {
                    editedB.current = true;
                    setInputB(event.target.value);
                  }}
                  spellCheck={false}
                  rows={7}
                  className="w-full resize-y rounded-card border border-line-subtle bg-night-950 p-4 font-mono text-[13px] leading-relaxed text-ghost-100 focus-visible:outline-2 focus-visible:outline-gold-200"
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div role="tablist" aria-label="Playground output" className="flex gap-1.5">
            {(
              [
                { id: "result", label: "result" },
                { id: "source", label: "generated source" },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                disabled={item.id === "source" && !opConfig.hasSource}
                onClick={() => setTab(item.id)}
                className={
                  tab === item.id
                    ? "rounded-control bg-gold-200 px-3.5 py-1.5 font-mono text-xs text-night-900"
                    : "rounded-control border border-line-subtle px-3.5 py-1.5 font-mono text-xs text-fg-muted hover:text-ghost-100 disabled:cursor-not-allowed disabled:opacity-40"
                }
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="min-h-95 flex-1 overflow-hidden rounded-card border border-line-subtle bg-night-950">
            {tab === "source" && response?.ok && response.source ? (
              <Editor
                height="380px"
                defaultLanguage="javascript"
                theme="jit-night"
                value={response.source}
                options={{ ...editorOptions, readOnly: true, lineNumbers: "off" }}
              />
            ) : (
              <div className="h-full overflow-auto p-4">
                {run.status === "idle" && (
                  <p className="font-mono text-sm text-fg-subtle">
                    Pick an operation and press “Compile &amp; run” — everything executes locally in a Web Worker.
                  </p>
                )}
                {run.status === "running" && <p className="font-mono text-sm text-gold-200">compiling…</p>}
                {run.status === "error" && <p className="font-mono text-sm text-danger">{run.message}</p>}
                {response && !response.ok && <p className="font-mono text-sm text-danger">{response.error}</p>}
                {response?.ok && tab === "source" && !response.source && (
                  <p className="font-mono text-sm text-fg-subtle">
                    this operation does not expose its generated source (yet)
                  </p>
                )}
                {response?.ok && tab === "result" && (
                  <pre className="whitespace-pre-wrap wrap-break-word font-mono text-[13px] leading-relaxed text-ghost-100">
                    {response.result}
                  </pre>
                )}
              </div>
            )}
          </div>

          {response?.ok && (
            <p className="font-mono text-[11px] text-fg-subtle">
              compiled in {response.compileMs.toFixed(2)} ms · ran in {response.runMs.toFixed(3)} ms
            </p>
          )}
          <p className="text-xs leading-relaxed text-fg-subtle">
            Your code never leaves this tab: it runs in a terminable Web Worker via{" "}
            <span className="font-mono">globalThis.Function</span>, is never sent to a server and is never logged.
          </p>
        </div>
      </div>
    </div>
  );
}
