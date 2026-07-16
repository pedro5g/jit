import { fileURLToPath } from "node:url";
import { JIT } from "@jit-compiler/jit/runtime";
import { events, invalidUser, type ShowcaseResult, users } from "../shared/data.js";
import { socketRoundTrip } from "../shared/socket.js";
import { EventSchema, PublicUserSchema, UserListSchema, UserSchema } from "./schemas.js";

export async function runRuntimeShowcase(): Promise<ShowcaseResult> {
  const validator = JIT.validator(UserSchema).get("is", "parse", "safeParse");
  const parsedUsers = users.map((user) => validator.parse(user));
  const invalid = validator.safeParse(invalidUser);
  const equal = JIT.equal(UserSchema).compile();
  const clone = JIT.clone(UserSchema).compile();
  const diff = JIT.diff(UserSchema).compile();
  const hash = JIT.hash(UserSchema).compile();
  const update = JIT.update(UserSchema)
    .patch({ name: JIT.param("name") })
    .compile();
  const mask = JIT.mask(UserSchema);
  const sanitize = JIT.sanitize(UserSchema);
  const mapper = JIT.mapper(UserSchema, PublicUserSchema).get("map");
  const stringify = JIT.json(UserSchema).stringify().compile();
  const fromJSON = JIT.json(UserSchema).parse().compile();
  const stringifyChunks = JIT.json(UserListSchema).stringifyChunks({ chunkBytes: 96 }).compile();
  const codec = JIT.codec(UserSchema, { version: 1 });
  const cloned = clone(parsedUsers[0]);
  const changed = update(parsedUsers[0], { name: "Ada Byron" });
  const json = stringify(parsedUsers[0]);
  const decodedJson = fromJSON(json);
  const encoded = codec.encode(parsedUsers[0]);
  const admins = JIT.query(UserListSchema)
    .filter((query) => query.and(query.eq("role", "admin"), query.eq("active", true)))
    .select("id", "name", "score")
    .compile()(parsedUsers);
  const iterateActive = JIT.query(UserListSchema)
    .filter((query) => query.eq("active", true))
    .select("id", "name")
    .take(10)
    .compileIterator();
  const visitActive = JIT.query(UserListSchema)
    .filter((query) => query.eq("active", true))
    .select("id")
    .compileVisitor();
  const lazyIds = [...iterateActive(parsedUsers)].map((user) => user.id);
  const visitedIds: number[] = [];
  const streamed = JIT.stream(UserListSchema);
  const streamJson = JSON.stringify(parsedUsers);

  visitActive(parsedUsers, (user) => visitedIds.push(user.id));
  for (let offset = 0; offset < streamJson.length; offset += 37) {
    streamed.write(streamJson.slice(offset, offset + 37));
  }

  const binary = JIT.array(EventSchema).binary({ strategy: "exact", memoryLayout: "columnar" });
  const rowset = binary.load(events);
  const binaryAdmins = JIT.query(rowset)
    .filter((query) => query.and(query.eq("region", "br"), query.eq("active", true)))
    .select("id", "userId", "score")
    .compile()(rowset);
  const binaryScore = JIT.process(EventSchema)
    .binary({ strategy: "exact", memoryLayout: "columnar" })
    .filter((query) => query.eq("active", true))
    .sum("score")
    .compile()
    .execute(events);
  const socketResponse = await socketRoundTrip(encoded, (bytes) => codec.encode(codec.decode(bytes)));
  const socketUser = codec.decode(socketResponse);
  const sanitized = sanitize(parsedUsers[0]);
  const publicUser = mapper.map(parsedUsers[0]);
  const result: ShowcaseResult = {
    mode: "runtime",
    validUsers: parsedUsers.filter((user) => validator.is(user)).length,
    invalidIssues: invalid.success ? 0 : invalid.issues.length,
    adminIds: admins.map((user) => user.id),
    lazyIds,
    visitedUsers: visitedIds.length,
    equalClone: equal(parsedUsers[0], cloned) && equal(parsedUsers[0], decodedJson),
    cloneDetached: cloned !== parsedUsers[0] && cloned.tags !== parsedUsers[0].tags,
    diffPaths: diff(parsedUsers[0], changed).map((entry) => entry.path.join(".")),
    stableHash: hash(parsedUsers[0]) === hash(cloned),
    updatedName: changed.name,
    publicKeys: Object.keys(publicUser),
    maskedEmail: mask(parsedUsers[0]).email,
    sanitizedBio: sanitized.profile?.bio ?? null,
    jsonBytes: Buffer.byteLength(json),
    jsonChunks: [...stringifyChunks(parsedUsers)].length,
    codecBytes: encoded.byteLength,
    streamedUsers: streamed.end().length,
    binaryAdminIds: binaryAdmins.map((event) => event.id),
    binaryScore,
    socketUserId: socketUser.id,
  };

  rowset.release();
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runRuntimeShowcase(), null, 2));
}
