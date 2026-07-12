import { fileURLToPath } from "node:url";
import { iterateActiveUsers, User, visitActiveUsers } from "#examples";
import { invalidUser, type ShowcaseResult, users } from "../shared/data.js";
import { socketRoundTrip } from "../shared/socket.js";

export async function runCompiledShowcase(): Promise<ShowcaseResult> {
  const parsedUsers = users.map((user) => User.parse(user));
  const invalid = User.safeParse(invalidUser);
  const cloned = User.clone(parsedUsers[0]);
  const changed = { ...parsedUsers[0], name: "Ada Byron" };
  const json = User.stringify(parsedUsers[0]);
  const decodedJson = User.fromJSON(json);
  const encoded = User.codec.encode(parsedUsers[0]);
  const admins = User.findActiveAdmins(parsedUsers);
  const lazyIds = [...iterateActiveUsers(parsedUsers)].map((user) => user.id);
  const visitedIds: number[] = [];

  visitActiveUsers(parsedUsers, (user) => visitedIds.push(user.id));

  const socketResponse = await socketRoundTrip(encoded, (bytes) => User.codec.encode(User.codec.decode(bytes)));
  const socketUser = User.codec.decode(socketResponse);
  const sanitized = User.sanitize(parsedUsers[0]);
  const publicUser = User.toPublicUser.map(parsedUsers[0]);

  return {
    mode: "aot",
    validUsers: parsedUsers.filter((user) => User.is(user)).length,
    invalidIssues: invalid.success ? 0 : invalid.issues.length,
    adminIds: admins.map((user) => user.id),
    lazyIds,
    visitedUsers: visitedIds.length,
    equalClone: User.equal(parsedUsers[0], cloned) && User.equal(parsedUsers[0], decodedJson),
    cloneDetached: cloned !== parsedUsers[0] && cloned.tags !== parsedUsers[0].tags,
    diffPaths: User.diff(parsedUsers[0], changed).map((entry) => entry.path.join(".")),
    stableHash: User.hash(parsedUsers[0]) === User.hash(cloned),
    updatedName: changed.name,
    publicKeys: Object.keys(publicUser),
    maskedEmail: User.mask(parsedUsers[0]).email,
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
