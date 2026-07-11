/**
 * Real generated sources, captured from the compiler for the landing `User`
 * schema (`JIT.<op>(User).compile().source`). Query and mapper sources come
 * from the byte-exact golden snapshots in
 * `packages/jit/src/compiler/__tests__/__snapshots__/`.
 */

export interface OperationSnippet {
  id: string;
  label: string;
  input: string;
  output: string;
}

const isInput = `const isUser = JIT.validate(User).is().compile();

isUser(value); // (value: unknown) => value is User
isUser.source; // the generated function below`;

const isOutput = `function is(value) {
  let v1 = value;
  if (v1 === null || typeof v1 !== "object" || Array.isArray(v1)) {
    return false;
  }
  let v3 = v1.id;
  if (typeof v3 !== "number") {
    return false;
  }
  if (!Number.isInteger(v3)) {
    return false;
  }
  if (v3 <= 0) {
    return false;
  }
  let v5 = v1.name;
  if (typeof v5 !== "string") {
    return false;
  }
  if (v5.length < 2) {
    return false;
  }
  let v7 = v1.email;
  if (typeof v7 !== "string") {
    return false;
  }
  if (!__v0.test(v7)) {
    return false;
  }
  let v9 = v1.role;
  if (!((v9 === "admin") || (v9 === "user"))) {
    return false;
  }
  let v11 = v1.tags;
  if (!Array.isArray(v11)) {
    return false;
  }
  if (v11.length > 8) {
    return false;
  }
  for (let i13 = 0; i13 < v11.length; i13++) {
    let v14 = v11[i13];
    if (typeof v14 !== "string") {
      return false;
    }
  }
  return true;
}`;

const equalInput = `const equalUser = JIT.equal(User).compile();

equalUser(a, b); // schema-aware deep equality`;

const equalOutput = `function equal(l, r) {
  if (l === r) {
    return true;
  }
  if (l.id !== r.id && (l.id === l.id || r.id === r.id)) {
    return false;
  }
  if (l.name !== r.name) {
    return false;
  }
  if (l.email !== r.email) {
    return false;
  }
  if (l.role !== r.role && (l.role === l.role || r.role === r.role)) {
    return false;
  }
  const l_tags = l.tags;
  const r_tags = r.tags;
  const len = l_tags.length;
  if (len !== r_tags.length) {
    return false;
  }
  for (let i = len; i-- !== 0;) {
    if (l_tags[i] !== r_tags[i]) {
      return false;
    }
  }
  return true;
}`;

const cloneInput = `const cloneUser = JIT.clone(User).compile();

cloneUser(user); // static-literal deep clone`;

const cloneOutput = `function clone(value) {
  const len = value.tags.length;
  const out_tags = new Array(len);
  for (let i = 0; i < len; i++) {
    out_tags[i] = value.tags[i];
  }
  const out = {
    id: value.id,
    name: value.name,
    email: value.email,
    role: value.role,
    "tags": out_tags
  };
  return out;
}`;

const stringifyInput = `const toJSON = JIT.json(User).stringify().compile();

toJSON(user); // static keys baked in, escape fast path`;

const stringifyOutput = `// excerpt — str() escape fast-path helper omitted
function stringify(value) {
  let s = "";
  s += "{";
  s += "\\"id\\":";
  s += Number.isFinite(value.id) ? "" + value.id : "null";
  s += ",\\"name\\":";
  s += str(value.name);
  s += ",\\"email\\":";
  s += str(value.email);
  s += ",\\"role\\":";
  s += JSON.stringify(value.role) ?? "null";
  s += ",\\"tags\\":";
  const v1 = value.tags;
  s += "[";
  for (let i2 = 0; i2 < v1.length; i2++) {
    if (i2 !== 0) s += ",";
    const e3 = v1[i2];
    s += str(e3);
  }
  s += "]";
  s += "}";
  return s;
}`;

const diffInput = `const diffUser = JIT.diff(User).compile();

diffUser(before, after); // structural diff entries`;

const diffOutput = `function diff(left, right) {
  const changes = [];
  if (Object.is(left, right)) {
    return changes;
  }
  if (!Object.is(left, right)) {
    if (!Object.is(left.id, right.id)) {
      changes[changes.length] = { type: "update", path: ["id"], value: right.id };
    }
    if (!Object.is(left.name, right.name)) {
      changes[changes.length] = { type: "update", path: ["name"], value: right.name };
    }
    if (!Object.is(left.email, right.email)) {
      changes[changes.length] = { type: "update", path: ["email"], value: right.email };
    }
    if (!Object.is(left.role, right.role)) {
      changes[changes.length] = { type: "update", path: ["role"], value: right.role };
    }
    if (!Object.is(left.tags, right.tags)) {
      const leftLen = left.tags.length;
      const rightLen = right.tags.length;
      const commonLen = leftLen < rightLen ? leftLen : rightLen;
      for (let i = 0; i < commonLen; i++) {
        if (!Object.is(left.tags[i], right.tags[i])) {
          changes[changes.length] = { type: "update", path: ["tags", i], value: right.tags[i] };
        }
      }
      for (let i = commonLen; i < rightLen; i++) {
        changes[changes.length] = { type: "add", path: ["tags", i], value: right.tags[i] };
      }
      for (let i = commonLen; i < leftLen; i++) {
        changes[changes.length] = { type: "remove", path: ["tags", i] };
      }
    }
  }
  return changes;
}`;

const queryInput = `const admins = JIT.query(UserList)
  .params({ minimumId: JIT.int() })
  .filter((q, params) =>
    q.and(q.not(q.eq("role", "blocked")), q.gt("id", params.minimumId)),
  )
  .select("id", "name", "role")
  .unique("id")
  .orderBy("name", "asc")
  .compile();

admins(users, { minimumId: 100 }); // one pass, no intermediates`;

const queryOutput = `function query(value) {
  const len = value.length;
  const seen = new Set();
  const out = new Array(len);
  let j = 0;
  for (let i = 0; i < len; i++) {
    const item = value[i];
    if ((item.role !== __q0) && ((item.id > __q1 || item.role === __q2))) {
      const uniqueKey = item.id;
      if (!seen.has(uniqueKey)) {
        seen.add(uniqueKey);
        out[j++] = { "id": item.id, "name": item.name, "role": item.role };
      }
    }
  }
  out.length = j;
  out.sort((left, right) => {
    const leftValue = left.name;
    const rightValue = right.name;
    if (leftValue === rightValue) return 0;
    return leftValue < rightValue ? -1 : 1;
  });
  return out;
}`;

const mapperInput = `const toDTO = JIT.mapper(UserEntity, PublicUser, {
  name: { from: "fullName" }, // rename
});

toDTO.map(entity);   // single object
toDTO.many(entities); // fused indexed loop`;

const mapperOutput = `{
  map: function map(source) {
    return {
      "id": source.id,
      "name": source.fullName,
      "profile": { "age": source.profile.age, "city": source.profile.city }
    };
  },
  many: function many(list) {
    const len = list.length;
    const out = new Array(len);
    for (let i = 0; i < len; i++) {
      const source = list[i];
      out[i] = {
        "id": source.id,
        "name": source.fullName,
        "profile": { "age": source.profile.age, "city": source.profile.city }
      };
    }
    return out;
  }
}`;

export const operationSnippets: OperationSnippet[] = [
  { id: "validate", label: "validate", input: isInput, output: isOutput },
  { id: "equal", label: "equal", input: equalInput, output: equalOutput },
  { id: "clone", label: "clone", input: cloneInput, output: cloneOutput },
  { id: "diff", label: "diff", input: diffInput, output: diffOutput },
  { id: "query", label: "query", input: queryInput, output: queryOutput },
  { id: "mapper", label: "mapper", input: mapperInput, output: mapperOutput },
  { id: "stringify", label: "stringify", input: stringifyInput, output: stringifyOutput },
];
