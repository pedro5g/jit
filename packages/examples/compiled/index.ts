import { fileURLToPath } from "node:url";
import { invalidUser, type ShowcaseResult, users } from "../shared/data.js";
import { socketRoundTrip } from "../shared/socket.js";
import { findActiveAdmins, iterateActiveUsers, toPublicUser, Users, visitActiveUsers } from "./generated/index.js";

export async function runCompiledShowcase(): Promise<ShowcaseResult> {
  const parsedUsers = users.map((user) => Users.parse(user));
  const invalid = Users.safeParse(invalidUser);
  const cloned = Users.clone(parsedUsers[0]);
  const changed = { ...parsedUsers[0], name: "Ada Byron" };
  const json = Users.stringify(parsedUsers[0]);
  const decodedJson = Users.fromJSON(json);
  const encoded = Users.codec.encode(parsedUsers[0]);
  const admins = findActiveAdmins(parsedUsers);
  const lazyIds = [...iterateActiveUsers(parsedUsers)].map((user) => user.id);
  const visitedIds: number[] = [];

  visitActiveUsers(parsedUsers, (user) => visitedIds.push(user.id));

  const socketResponse = await socketRoundTrip(encoded, (bytes) => Users.codec.encode(Users.codec.decode(bytes)));
  const socketUser = Users.codec.decode(socketResponse);
  const sanitized = Users.sanitize(parsedUsers[0]);
  const publicUser = toPublicUser(parsedUsers[0]);

  return {
    mode: "aot",
    validUsers: parsedUsers.filter((user) => Users.is(user)).length,
    invalidIssues: invalid.success ? 0 : invalid.issues.length,
    adminIds: admins.map((user) => user.id),
    lazyIds,
    visitedUsers: visitedIds.length,
    equalClone: Users.equal(parsedUsers[0], cloned) && Users.equal(parsedUsers[0], decodedJson),
    cloneDetached: cloned !== parsedUsers[0] && cloned.tags !== parsedUsers[0].tags,
    diffPaths: Users.diff(parsedUsers[0], changed).map((entry) => entry.path.join(".")),
    stableHash: Users.hash(parsedUsers[0]) === Users.hash(cloned),
    updatedName: changed.name,
    publicKeys: Object.keys(publicUser),
    maskedEmail: Users.mask(parsedUsers[0]).email,
    sanitizedBio: sanitized.profile?.bio ?? null,
    jsonBytes: Buffer.byteLength(json),
    jsonChunks: 0,
    codecBytes: encoded.byteLength,
    streamedUsers: 0,
    binaryAdminIds: [],
    binaryScore: 0,
    socketUserId: socketUser.id,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runCompiledShowcase(), null, 2));
}
