export function basename(path: string): string {
  const normalized = normalize(path);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

export function join(...parts: readonly string[]): string {
  return normalize(parts.filter(Boolean).join("/"));
}

export function resolve(...parts: readonly string[]): string {
  const joined = parts.filter(Boolean).join("/");
  return normalize(joined.startsWith("/") ? joined : `/${joined}`);
}

export function relative(from: string, to: string): string {
  const left = resolve(from).split("/").filter(Boolean);
  const right = resolve(to).split("/").filter(Boolean);
  let shared = 0;

  while (shared < left.length && left[shared] === right[shared]) shared++;
  return [...left.slice(shared).map(() => ".."), ...right.slice(shared)].join("/") || ".";
}

function normalize(path: string): string {
  const absolute = path.startsWith("/");
  const parts: string[] = [];

  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }

  return `${absolute ? "/" : ""}${parts.join("/")}` || (absolute ? "/" : ".");
}
