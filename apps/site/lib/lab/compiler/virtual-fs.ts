const files = new Map<string, string>();

export function resetVirtualFiles(): void {
  files.clear();
}

export function readVirtualFile(path: string): string {
  const value = files.get(normalize(path));
  if (value === undefined) throw new Error(`virtual file not found: ${path}`);
  return value;
}

export function existsSync(path: string): boolean {
  const normalized = normalize(path);
  return files.has(normalized) || [...files.keys()].some((file) => file.startsWith(`${normalized}/`));
}

export function mkdirSync(_path: string, _options?: { readonly recursive?: boolean }): undefined {
  return undefined;
}

/** Direct children of a virtual directory; the generator uses it to clean. */
export function readdirSync(path: string): string[] {
  const prefix = `${normalize(path)}/`;
  const names = new Set<string>();

  for (const file of files.keys()) {
    if (!file.startsWith(prefix)) continue;
    const rest = file.slice(prefix.length);
    const slash = rest.indexOf("/");

    names.add(slash === -1 ? rest : rest.slice(0, slash));
  }

  return [...names];
}

export function readFileSync(path: string, _encoding: string): string {
  return readVirtualFile(path);
}

export function writeFileSync(path: string, content: string): void {
  files.set(normalize(path), content);
}

export function rmSync(path: string, options?: { readonly recursive?: boolean; readonly force?: boolean }): void {
  const normalized = normalize(path);
  files.delete(normalized);
  if (options?.recursive) {
    for (const file of files.keys()) {
      if (file.startsWith(`${normalized}/`)) files.delete(file);
    }
  }
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
