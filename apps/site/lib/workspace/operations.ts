import type { PlaygroundOp } from "@/lib/playground/worker";
import type { WorkspaceProject } from "./project";

/**
 * What the workspace can run, and the sample data each operation needs.
 *
 * This is plain data on purpose: the assistant reads the same catalog to pick
 * an operation for a schema it just wrote, and the editor, the run panel and
 * the ghost all agree on what "map" or "binary" means without any of them
 * owning the definition.
 */
export interface OperationConfig {
  id: PlaygroundOp;
  label: string;
  /** Overrides the "value (JSON)" label when the input is a collection. */
  aLabel?: string;
  needsB: false | { label: string; default: string };
  /** Whether the compiler can show generated source for this operation. */
  hasSource: boolean;
}

export interface WorkspaceExample {
  id: string;
  label: string;
  code: string;
  a: string;
  op: PlaygroundOp;
}

export const DEFAULT_CODE = `import { JIT } from "@jit-compiler/jit/runtime";

const schema = JIT.object({
  id: JIT.number().int().positive(),
  name: JIT.string().min(2),
  email: JIT.string().email().pii("mask"),
  role: JIT.union(JIT.literal("admin"), JIT.literal("user")),
  tags: JIT.array(JIT.string()).max(8),
});

// full type inference — hover User:
type User = JIT.Typeof<typeof schema>;

const isUser = JIT.validate.is(schema);

export { schema, isUser };
export type { User };
`;

/**
 * The project a first visit opens with.
 *
 * Two files rather than one, because the thing the workspace is for is a
 * schema layer, and a schema layer is never a single file. `account-schemas.ts`
 * reads a schema out of `user-schemas.ts`, so the tree also shows the part that
 * is easy to get wrong: a file that depends on another is compiled after it,
 * and generation mirrors the layout into the directory the CLI writes.
 */
export const STARTER_PROJECT: WorkspaceProject = {
  activePath: "user-schemas.ts",
  directories: [],
  files: [
    { path: "user-schemas.ts", source: DEFAULT_CODE },
    {
      path: "account-schemas.ts",
      source: `import { JIT } from "@jit-compiler/jit/runtime";
import { schema as User } from "./user-schemas";

// a schema from another file is an ordinary value: compose it
const schema = JIT.object({
  id: JIT.string().uuid(),
  owner: User,
  plan: JIT.union(JIT.literal("free"), JIT.literal("pro")),
  seats: JIT.number().int().min(1).max(500),
});

const isAccount = JIT.validate.is(schema);
const parseAccount = JIT.validate.parse(schema);

export { schema, isAccount, parseAccount };
`,
    },
  ],
};

export const DEFAULT_INPUT = `{
  "id": 1,
  "name": "Ada",
  "email": "ada@lovelace.dev",
  "role": "admin",
  "tags": ["compiler"]
}`;

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

export const OPERATIONS: OperationConfig[] = [
  { id: "validate", label: "validate", needsB: false, hasSource: true },
  { id: "parse", label: "parse", needsB: false, hasSource: true },
  { id: "equal", label: "equal", needsB: { label: "value B", default: DEFAULT_INPUT }, hasSource: true },
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
  { id: "mapper", label: "map", aLabel: "value (JSON)", needsB: false, hasSource: true },
  { id: "compile", label: "compile", needsB: false, hasSource: false },
  { id: "dto", label: "dto", aLabel: "entity or entities (JSON)", needsB: false, hasSource: false },
  {
    id: "indexes",
    label: "indexes",
    aLabel: "entity collection",
    needsB: { label: "reordered collection", default: reorderedEntityUsersInput },
    hasSource: true,
  },
];

export const EXAMPLES: WorkspaceExample[] = [
  { id: "user", label: "User validator", code: DEFAULT_CODE, a: DEFAULT_INPUT, op: "validate" },
  {
    id: "invalid",
    label: "Invalid input (issues)",
    code: DEFAULT_CODE,
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
    code: DEFAULT_CODE,
    a: DEFAULT_INPUT,
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
  const store = JIT.state.update(schema).reactive(initial);
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
    code: DEFAULT_CODE,
    a: DEFAULT_INPUT,
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
const query = JIT.cqrs.query(JIT.array(schema))
  .params({ minimumId: JIT.int() })
  .filter((q, p) => q.and(q.eq("role", "admin"), q.gte("id", p.minimumId)))
  .select("id", "name", "role")
  .orderBy("name", "asc");
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
const lazy = JIT.cqrs.query(JIT.array(schema))
  .filter((q) => q.eq("active", true))
  .select("id", "score")
  .take(2)
  .lazy();
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
const visitor = JIT.cqrs.query(JIT.array(schema))
  .filter((q) => q.and(q.eq("active", true), q.gte("score", 40)))
  .select("id", "score")
  .to.visitor();
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
const watch = JIT.state.watch(Users, { key: "id" });
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
  JIT.ddd.watchedList(Users, initial, { key: "id" });
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
const binaryQuery = JIT.cqrs.query(binary)
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
const stringifyChunks = JIT.json.stringifyChunks(schema, { chunkBytes: 48 });
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
const mapper = JIT.map(schema, PublicUser, {
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
    id: "compile",
    label: "Explicit artifact group",
    code: `import { JIT } from "@jit-compiler/jit/runtime";

const schema = JIT.object({
  id: JIT.number().int32().positive(),
  name: JIT.string().min(2),
  email: JIT.string().email(),
});

// Only these methods exist, compile, and enter the runtime bundle.
const compiled = {
  is: JIT.validate.is(schema),
  parse: JIT.validate.parse(schema),
  clone: JIT.clone(schema),
};
`,
    a: `{ "id": 1, "name": "Ada", "email": "ada@lovelace.dev" }`,
    op: "compile",
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

const PublicUser = JIT.dto(JIT.object({
  id: JIT.number().int32(),
  name: JIT.string(),
  city: JIT.string(),
}));

const dto = JIT.from(schema).map(PublicUser, {
  name: { from: "fullName" },
  city: (user) => user.profile.city,
});
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
  entityEqual: JIT.compare.equal(EntityUsers),
  // indexBy/keyed match reordered entities by id
  indexedEqual: JIT.compare.equal(IndexedUsers),
  keyedEqual: JIT.compare.equal(KeyedUsers),
  // entity metadata supplies the default normalization key
  normalize: Compiler.compileNormalize(EntityUsers.schema),
  // query keyed() is a fresh Map collector, not a retained schema index
  keyedQuery: JIT.cqrs.query(JIT.array(schema)).keyed("id").select("name"),
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
