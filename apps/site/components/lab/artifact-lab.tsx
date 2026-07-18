"use client";

import type { AotOutputFormat } from "@jit-compiler/jit/aot";
import Editor, { type Monaco } from "@monaco-editor/react";
import { Check, Clipboard, FileCode2, PackageCheck, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCopy } from "@/hooks/use-copy";
import type { LabCompilerRequest, LabCompilerResponse, LabCompilerResult } from "@/lib/lab/compiler/worker-types";
import { type PublishedArtifact, publishArtifact } from "@/lib/lab/registry/client";

const FIXED_IMPORT = 'import { JIT } from "@jit-compiler/jit/define";';
const COMPILER_TIMEOUT_MS = 5_000;

type PackageManager = "pnpm" | "npm" | "yarn" | "bun";
type OutputTab = "source" | "token";

const editorOptions = {
  minimap: { enabled: false },
  fontSize: 13,
  lineHeight: 21,
  scrollBeyondLastLine: false,
  padding: { top: 12, bottom: 12 },
  tabSize: 2,
  automaticLayout: true,
  wordWrap: "on",
  scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  renderLineHighlight: "none",
  overviewRulerLanes: 0,
  fixedOverflowWidgets: true,
} as const;

const formatOptions: readonly { readonly value: AotOutputFormat; readonly label: string }[] = [
  { value: "typescript", label: "TypeScript" },
  { value: "javascript", label: "JavaScript + types" },
  { value: "javascript-only", label: "JavaScript only" },
];

export function ArtifactLab() {
  const [body, setBody] = useState("");
  const [fileName, setFileName] = useState("schemas.generated");
  const [outputRoot, setOutputRoot] = useState("src/generated/jit");
  const [format, setFormat] = useState<AotOutputFormat>("typescript");
  const [packageManager, setPackageManager] = useState<PackageManager>("pnpm");
  const [dts, setDts] = useState<Record<string, string> | null>(null);
  const [compiled, setCompiled] = useState<LabCompilerResult>();
  const [selectedFile, setSelectedFile] = useState("");
  const [token, setToken] = useState("");
  const [report, setReport] = useState<PublishedArtifact>();
  const [tab, setTab] = useState<OutputTab>("source");
  const [status, setStatus] = useState<"idle" | "working" | "ready" | "error">("idle");
  const [message, setMessage] = useState("Ready");
  const monacoRef = useRef<Monaco | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);
  const { copied, copyToClipboard } = useCopy();

  useEffect(() => {
    fetch("/playground/jit-dts.json")
      .then((response) => (response.ok ? response.json() : null))
      .then((manifest) => setDts(manifest?.files ?? {}))
      .catch(() => setDts({}));

    return () => {
      workerRef.current?.terminate();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const beforeMount = useCallback(
    (monaco: Monaco) => {
      defineLabTheme(monaco);
      const ts = monaco.languages.typescript;
      ts.typescriptDefaults.setCompilerOptions({
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        strict: true,
        esModuleInterop: true,
        allowNonTsExtensions: true,
      });
      ts.typescriptDefaults.setEagerModelSync(true);

      if (dts) {
        for (const [path, content] of Object.entries(dts)) {
          ts.typescriptDefaults.addExtraLib(content, `file:///node_modules/@jit-compiler/jit/${path}`);
        }
      }
      ts.typescriptDefaults.addExtraLib(
        'declare const JIT: typeof import("@jit-compiler/jit/define").JIT;',
        "file:///lab/jit-global.d.ts"
      );
    },
    [dts]
  );

  const compileTypeScript = useCallback(async (): Promise<{ readonly code: string; readonly names: string[] }> => {
    const monaco = monacoRef.current;
    if (!monaco) throw new Error("Editor is not ready");
    const uri = monaco.Uri.parse("file:///lab/schema.ts");
    const getWorker = await monaco.languages.typescript.getTypeScriptWorker();
    const client = await getWorker(uri);
    const [syntactic, semantic, output] = await Promise.all([
      client.getSyntacticDiagnostics(uri.toString()),
      client.getSemanticDiagnostics(uri.toString()),
      client.getEmitOutput(uri.toString()),
    ]);
    const issue = [...syntactic, ...semantic][0];

    if (issue) throw new Error(flattenDiagnostic(issue.messageText));
    const code = output.outputFiles[0]?.text;
    if (!code) throw new Error("TypeScript did not emit JavaScript");
    const names = collectTopLevelNames(body);
    if (names.length === 0) throw new Error("Declare at least one schema or compiled function");
    return { code, names };
  }, [body]);

  const generate = useCallback(async () => {
    setStatus("working");
    setMessage("Compiling");

    try {
      validateDestination(fileName, outputRoot);
      const transpiled = await compileTypeScript();
      requestId.current += 1;
      const id = requestId.current;
      const worker = new Worker(new URL("../../lib/lab/compiler/worker.ts", import.meta.url));
      workerRef.current?.terminate();
      workerRef.current = worker;

      const result = await new Promise<LabCompilerResult>((resolve, reject) => {
        timeoutRef.current = setTimeout(() => {
          worker.terminate();
          reject(new Error(`Compilation exceeded ${COMPILER_TIMEOUT_MS} ms`));
        }, COMPILER_TIMEOUT_MS);
        worker.onmessage = (event: MessageEvent<LabCompilerResponse>) => {
          if (event.data.id !== id) return;
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          if (event.data.ok) resolve(event.data.result);
          else reject(new Error(event.data.error));
        };
        worker.onerror = () => {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          reject(new Error("AOT compiler worker crashed"));
        };
        worker.postMessage({
          id,
          code: transpiled.code,
          names: transpiled.names,
          options: { format, fileName },
        } satisfies LabCompilerRequest);
      });
      if (result.files.length === 0) {
        throw new Error(result.skipped[0]?.reason ?? "No compiled functions were found");
      }

      setMessage("Signing artifact");
      const published = await publishArtifact(result.files, outputRoot);
      setCompiled(result);
      setSelectedFile(result.files[0]?.path ?? "");
      setToken(published.token);
      setReport(published);
      setTab("source");
      setStatus("ready");
      setMessage("Generated");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Generation failed");
    }
  }, [compileTypeScript, fileName, format, outputRoot]);

  const source = compiled?.files.find((file) => file.path === selectedFile)?.source ?? "";
  const command = useMemo(() => artifactCommand(packageManager, token), [packageManager, token]);
  const currentOutput = tab === "source" ? source : token;

  return (
    <div className="overflow-hidden border border-line bg-night-950 shadow-(--shadow-card)">
      <div className="grid min-h-175 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="border-b border-line-subtle bg-night-900 lg:border-r lg:border-b-0">
          <div className="border-b border-line-subtle px-4 py-4">
            <h2 className="font-mono text-sm font-semibold text-ghost-100">AOT output</h2>
          </div>
          <div className="flex flex-col gap-4 p-4">
            <LabeledInput label="File name" value={fileName} onChange={setFileName} />
            <LabeledInput label="Output directory" value={outputRoot} onChange={setOutputRoot} />
            <LabeledSelect
              label="Format"
              value={format}
              onChange={(value) => setFormat(value as AotOutputFormat)}
              options={formatOptions}
            />
            <LabeledSelect
              label="Package manager"
              value={packageManager}
              onChange={(value) => setPackageManager(value as PackageManager)}
              options={[
                { value: "pnpm", label: "pnpm" },
                { value: "npm", label: "npm" },
                { value: "yarn", label: "Yarn" },
                { value: "bun", label: "Bun" },
              ]}
            />
            <button
              type="button"
              onClick={generate}
              disabled={status === "working" || dts === null}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-control bg-gold-200 px-4 text-sm font-semibold text-night-900 hover:bg-gold-100 disabled:cursor-wait disabled:opacity-60"
            >
              <PackageCheck className="size-4" />
              {status === "working" ? "Generating" : "Generate"}
            </button>
          </div>
          <div className="border-t border-line-subtle p-4">
            <span className="mb-2 block font-mono text-[11px] uppercase text-fg-subtle">Command</span>
            <button
              type="button"
              disabled={!token}
              onClick={() => command && copyToClipboard(command)}
              className="group flex w-full items-start gap-2 text-left disabled:opacity-40"
            >
              <code className="min-w-0 flex-1 wrap-break-word font-mono text-xs leading-relaxed text-ghost-200">
                {command || `${packageManager} dlx @jit-compiler/cli add <token>`}
              </code>
              {copied ? <Check className="mt-0.5 size-3.5 text-success" /> : <Clipboard className="mt-0.5 size-3.5" />}
            </button>
          </div>
        </aside>

        <div className="grid min-w-0 xl:grid-cols-2">
          <section className="min-w-0 border-b border-line-subtle xl:border-r xl:border-b-0">
            <div className="flex h-12 items-center border-b border-line-subtle px-4">
              <FileCode2 className="mr-2 size-4 text-gold-200" />
              <span className="font-mono text-xs text-ghost-100">schema.ts</span>
            </div>
            <div className="border-b border-line-subtle bg-night-1000 px-4 py-2 font-mono text-xs text-fg-muted">
              {FIXED_IMPORT}
            </div>
            {dts ? (
              <Editor
                height="620px"
                path="file:///lab/schema.ts"
                defaultLanguage="typescript"
                theme="jit-night"
                value={body}
                onChange={(value) => setBody(value ?? "")}
                beforeMount={beforeMount}
                onMount={(_editor, monaco) => {
                  monacoRef.current = monaco;
                }}
                options={editorOptions}
                loading={<EditorLoading label="Loading editor" />}
              />
            ) : (
              <EditorLoading label="Loading JIT types" />
            )}
          </section>

          <section className="flex min-w-0 flex-col">
            <div className="flex h-12 flex-wrap items-center justify-between gap-2 border-b border-line-subtle px-3">
              <div className="flex gap-1" role="tablist" aria-label="Generated artifact">
                <Tab active={tab === "source"} onClick={() => setTab("source")} icon={<FileCode2 />}>
                  Output
                </Tab>
                <Tab active={tab === "token"} onClick={() => setTab("token")} icon={<ShieldCheck />}>
                  Token
                </Tab>
              </div>
              <button
                type="button"
                title="Copy output"
                disabled={!currentOutput}
                onClick={() => currentOutput && copyToClipboard(currentOutput)}
                className="inline-flex size-8 items-center justify-center rounded-control text-fg-muted hover:bg-surface-900 hover:text-gold-200 disabled:opacity-30"
              >
                <Clipboard className="size-4" />
              </button>
            </div>

            {tab === "source" ? (
              <>
                {compiled && compiled.files.length > 1 && (
                  <div className="flex gap-1 overflow-x-auto border-b border-line-subtle px-3 py-2">
                    {compiled.files.map((file) => (
                      <button
                        key={file.path}
                        type="button"
                        onClick={() => setSelectedFile(file.path)}
                        className={
                          selectedFile === file.path
                            ? "rounded-control bg-surface-900 px-2.5 py-1 font-mono text-xs text-gold-200"
                            : "rounded-control px-2.5 py-1 font-mono text-xs text-fg-muted"
                        }
                      >
                        {file.path}
                      </button>
                    ))}
                  </div>
                )}
                <Editor
                  height="574px"
                  path={`file:///lab/output/${selectedFile || "output.ts"}`}
                  defaultLanguage={selectedFile.endsWith(".ts") ? "typescript" : "javascript"}
                  theme="jit-night"
                  value={source}
                  options={{ ...editorOptions, readOnly: true, lineNumbers: "off" }}
                  loading={<EditorLoading label="No output" />}
                />
              </>
            ) : (
              <textarea
                aria-label="Artifact token"
                value={token}
                readOnly
                spellCheck={false}
                className="min-h-155 flex-1 resize-none bg-night-1000 p-4 font-mono text-xs leading-relaxed text-ghost-200 outline-none"
              />
            )}

            <div className="grid gap-2 border-t border-line-subtle px-4 py-3 sm:grid-cols-[auto_1fr_auto] sm:items-center">
              <span className={statusColor(status)}>{message}</span>
              <span className="truncate font-mono text-xs text-fg-subtle">{report?.hash ?? "No digest"}</span>
              <span className="font-mono text-xs text-fg-muted">
                {report ? `${report.files} files · ${formatBytes(report.bytes)}` : format}
              </span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function defineLabTheme(monaco: Monaco): void {
  monaco.editor.defineTheme("jit-night", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "c69cff" },
      { token: "type.identifier", foreground: "7db7ff" },
      { token: "string", foreground: "9dd8a8" },
      { token: "number", foreground: "ffb86b" },
      { token: "comment", foreground: "6f777b" },
    ],
    colors: {
      "editor.background": "#121520",
      "editor.foreground": "#e8e2c5",
      "editorLineNumber.foreground": "#454d50",
      "editorLineNumber.activeForeground": "#777f82",
      "editorWidget.background": "#171b25",
      "editorSuggestWidget.background": "#171b25",
      "editorSuggestWidget.selectedBackground": "#23292f",
      "input.background": "#121520",
    },
  });
}

function collectTopLevelNames(source: string): string[] {
  const names = new Set<string>();
  const pattern = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1]) names.add(match[1]);
  }
  return [...names];
}

function flattenDiagnostic(message: unknown): string {
  if (typeof message === "string") return message;
  if (message !== null && typeof message === "object" && "messageText" in message) {
    return String(message.messageText);
  }
  return "TypeScript compilation failed";
}

function validateDestination(fileName: string, outputRoot: string): void {
  if (!/^[A-Za-z0-9_$.-]+$/.test(fileName) || fileName === "." || fileName === "..") {
    throw new Error("File name must be a portable basename");
  }
  if (
    outputRoot.startsWith("/") ||
    outputRoot.includes("\\") ||
    outputRoot.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error("Output directory must be a normalized relative path");
  }
}

function artifactCommand(manager: PackageManager, token: string): string {
  if (!token) return "";
  if (manager === "pnpm") return `pnpm dlx @jit-compiler/cli add ${token}`;
  if (manager === "yarn") return `yarn dlx @jit-compiler/cli add ${token}`;
  if (manager === "bun") return `bunx @jit-compiler/cli add ${token}`;
  return `npx @jit-compiler/cli add ${token}`;
}

function statusColor(status: "idle" | "working" | "ready" | "error"): string {
  if (status === "error") return "font-mono text-xs text-danger";
  if (status === "ready") return "font-mono text-xs text-success";
  return "font-mono text-xs text-fg-muted";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function EditorLoading({ label }: { readonly label: string }) {
  return (
    <div className="flex h-155 items-center justify-center bg-night-1000 font-mono text-xs text-fg-subtle">{label}</div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[11px] uppercase text-fg-subtle">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full border border-line bg-night-1000 px-2.5 font-mono text-xs text-ghost-100 outline-none focus:border-line-gold"
      />
    </label>
  );
}

function LabeledSelect({
  label,
  value,
  onChange,
  options,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[11px] uppercase text-fg-subtle">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full border border-line bg-night-1000 px-2.5 font-mono text-xs text-ghost-100 outline-none focus:border-line-gold"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Tab({
  active,
  onClick,
  icon,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly icon: React.ReactElement<{ className?: string }>;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        active
          ? "inline-flex h-8 items-center gap-2 rounded-control bg-surface-900 px-3 text-xs text-gold-200"
          : "inline-flex h-8 items-center gap-2 rounded-control px-3 text-xs text-fg-muted hover:text-ghost-100"
      }
    >
      <span className="[&>svg]:size-3.5">{icon}</span>
      {children}
    </button>
  );
}
