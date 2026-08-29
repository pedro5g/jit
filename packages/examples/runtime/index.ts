import { fileURLToPath } from "node:url";
import { JIT } from "@jit-compiler/jit/runtime";
import { events, invalidUser, type ShowcaseResult, users } from "../shared/data.js";
import { socketRoundTrip } from "../shared/socket.js";
import { EventSchema, PublicUserSchema, UserListSchema, UserSchema } from "./schemas.js";

export async function runRuntimeShowcase(): Promise<ShowcaseResult> {
  const validator = {
    is: JIT.validate.is(UserSchema),
    parse: JIT.validate.parse(UserSchema),
    safeParse: JIT.validate.safeParse(UserSchema),
  };
  const parsedUsers = users.map((user) => validator.parse(user));
  const invalid = validator.safeParse(invalidUser);
  const equal = JIT.compare.equal(UserSchema);
  const clone = JIT.clone(UserSchema);
  const diff = JIT.compare.diff(UserSchema);
  const hash = JIT.compare.hash(UserSchema);
  const update = JIT.state
    .update(UserSchema)
    .patch({ name: JIT.cqrs.param("name") })
    .compile();
  const mask = JIT.security.mask(UserSchema);
  const sanitize = JIT.security.sanitize(UserSchema);
  const mapper = JIT.map(UserSchema, PublicUserSchema);
  const stringify = JIT.json.stringify(UserSchema);
  const fromJSON = JIT.json.parse(UserSchema).validate();
  const stringifyChunks = JIT.json.stringifyChunks(UserListSchema, { chunkBytes: 96 });
  const codec = {
    encode: JIT.binary.encode(UserSchema),
    decode: JIT.binary.decode(UserSchema),
  };
  const cloned = clone(parsedUsers[0]);
  const changed = update(parsedUsers[0], { name: "Ada Byron" });
  const json = stringify(parsedUsers[0]);
  const decodedJson = fromJSON(json);
  const encoded = codec.encode(parsedUsers[0]);
  const admins = JIT.cqrs
    .query(UserListSchema)
    .filter((query) => query.and(query.eq("role", "admin"), query.eq("active", true)))
    .select(
      "id",
      "name",
      "score"
    )(parsedUsers);
  const iterateActive = JIT.cqrs
    .query(UserListSchema)
    .filter((query) => query.eq("active", true))
    .select("id", "name")
    .take(10)
    .to.iterator();
  const visitActive = JIT.cqrs
    .query(UserListSchema)
    .filter((query) => query.eq("active", true))
    .select("id")
    .to.visitor();
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
  const binaryAdmins = JIT.cqrs
    .query(rowset)
    .filter((query) => query.and(query.eq("region", "br"), query.eq("active", true)))
    .select(
      "id",
      "userId",
      "score"
    )(rowset);
  const binaryScore = JIT.process(EventSchema)
    .binary({ strategy: "exact", memoryLayout: "columnar" })
    .filter((query) => query.eq("active", true))
    .sum("score")
    .compile()
    .execute(events);
  const socketResponse = await socketRoundTrip(encoded, (bytes) => codec.encode(codec.decode(bytes)));
  const socketUser = codec.decode(socketResponse);
  const sanitized = sanitize(parsedUsers[0]);
  const publicUser = mapper(parsedUsers[0]);
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
