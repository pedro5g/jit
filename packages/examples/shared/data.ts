export interface UserValue {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly role: "admin" | "member";
  readonly active: boolean;
  readonly score: number;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly profile?: {
    readonly bio: string | null;
  };
}

export interface EventValue {
  readonly id: number;
  readonly userId: number;
  readonly kind: "login" | "purchase";
  readonly active: boolean;
  readonly score: number;
  readonly region: string;
  readonly at: string;
}

export interface ShowcaseResult {
  readonly mode: "runtime" | "aot";
  readonly validUsers: number;
  readonly invalidIssues: number;
  readonly adminIds: readonly number[];
  readonly lazyIds: readonly number[];
  readonly visitedUsers: number;
  readonly equalClone: boolean;
  readonly cloneDetached: boolean;
  readonly diffPaths: readonly string[];
  readonly stableHash: boolean;
  readonly updatedName: string;
  readonly publicKeys: readonly string[];
  readonly maskedEmail: string;
  readonly sanitizedBio: string | null;
  readonly jsonBytes: number;
  readonly jsonChunks: number;
  readonly codecBytes: number;
  readonly streamedUsers: number;
  readonly binaryAdminIds: readonly number[];
  readonly binaryScore: number;
  readonly socketUserId: number;
}

export const users: readonly UserValue[] = [
  {
    id: 1,
    name: "Ada Lovelace",
    email: "ada@example.com",
    role: "admin",
    active: true,
    score: 98.5,
    tags: ["compiler", "math"],
    createdAt: "2026-07-01T10:00:00Z",
    profile: { bio: "<script>ignored()</script>First programmer" },
  },
  {
    id: 2,
    name: "Grace Hopper",
    email: "grace@example.com",
    role: "admin",
    active: false,
    score: 93,
    tags: ["compiler", "navy"],
    createdAt: "2026-07-02T11:30:00Z",
    profile: { bio: "COBOL pioneer" },
  },
  {
    id: 3,
    name: "Margaret Hamilton",
    email: "margaret@example.com",
    role: "member",
    active: true,
    score: 96.25,
    tags: ["apollo", "software"],
    createdAt: "2026-07-03T12:45:00Z",
  },
] as const;

export const invalidUser: unknown = {
  id: 0,
  name: "x",
  email: "invalid",
  role: "root",
  active: "yes",
  score: 120,
  tags: [],
  createdAt: "tomorrow",
};

export const events: readonly EventValue[] = [
  { id: 1, userId: 1, kind: "login", active: true, score: 9.5, region: "br", at: "2026-07-01T10:00:00Z" },
  {
    id: 2,
    userId: 2,
    kind: "purchase",
    active: false,
    score: 5.25,
    region: "us",
    at: "2026-07-01T10:01:00Z",
  },
  {
    id: 3,
    userId: 1,
    kind: "purchase",
    active: true,
    score: 11.75,
    region: "br",
    at: "2026-07-01T10:02:00Z",
  },
] as const;
