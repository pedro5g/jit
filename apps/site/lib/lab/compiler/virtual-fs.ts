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
