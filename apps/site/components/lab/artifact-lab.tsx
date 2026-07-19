"use client";

import type { AotOutputFormat } from "@jit-compiler/jit/aot";
import Editor, { type Monaco } from "@monaco-editor/react";
import {
  Check,
  Clipboard,
  Code2,
  FileCode2,
  Home,
  LockKeyhole,
  PackageCheck,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Settings2,
  ShieldCheck,
  TerminalSquare,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JitLogo } from "@/components/brand/jit-logo";
import { Select, type SelectOption } from "@/components/ui/select";
import { useCopy } from "@/hooks/use-copy";
import type { LabCompilerRequest, LabCompilerResponse, LabCompilerResult } from "@/lib/lab/compiler/worker-types";
import { type PublishedArtifact, publishArtifact } from "@/lib/lab/registry/client";

const FIXED_IMPORT = 'import { JIT } from "@jit-compiler/jit/define";';
const FIXED_PREFIX = `${FIXED_IMPORT}\n\n`;
const STARTER_SOURCE = `const User = JIT.object({
  id: JIT.number().int32(),
  name: JIT.string().min(2),
  role: JIT.union(
    JIT.literal("admin"),
    JIT.literal("member"),
  ),
});

const isUser = JIT.validator(User).get("is").is;`;
const COMPILER_TIMEOUT_MS = 5_000;

type PackageManager = "pnpm" | "npm" | "yarn" | "bun";
type OutputTab = "source" | "token";
type Status = "idle" | "working" | "ready" | "error";
type Panel = "config" | "result";

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
  renderLineHighlight: "line",
  overviewRulerLanes: 0,
  fixedOverflowWidgets: true,
  glyphMargin: true,
} as const;

const formatOptions: readonly SelectOption[] = [
  {
    value: "typescript",
    label: "TypeScript",
    description: "Pure .ts with types in the generated source",
  },
  {
    value: "javascript",
    label: "JavaScript + types",
    description: "Runtime .js plus a matching .d.ts",
  },
  {
    value: "javascript-only",
    label: "JavaScript only",
    description: "Smallest output without declarations",
  },
];

const packageManagerOptions: readonly SelectOption[] = [
  { value: "pnpm", label: "pnpm", description: "Recommended for this workspace" },
  { value: "npm", label: "npm", description: "Use the project-local CLI" },
  { value: "yarn", label: "Yarn", description: "Use the project-local CLI" },
  { value: "bun", label: "Bun", description: "Use the project-local CLI" },
];

export function ArtifactLab() {
  const [body, setBody] = useState(STARTER_SOURCE);
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
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("Ready");
  const [desktop, setDesktop] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<Exclude<PackageManager, "pnpm"> | null>(null);
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

    const media = window.matchMedia("(min-width: 1024px)");
    const syncViewport = (matches: boolean) => {
      setDesktop(matches);
      setConfigOpen(matches);
      setResultOpen(matches);
    };

    syncViewport(media.matches);
    const onMediaChange = (event: MediaQueryListEvent) => syncViewport(event.matches);
    media.addEventListener("change", onMediaChange);

    return () => {
      media.removeEventListener("change", onMediaChange);
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
      setResultOpen(true);
      if (!desktop) setConfigOpen(false);
      setStatus("ready");
      setMessage("Generated");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Generation failed");
    }
  }, [compileTypeScript, desktop, fileName, format, outputRoot]);

  const source = compiled?.files.find((file) => file.path === selectedFile)?.source ?? "";
  const command = useMemo(() => artifactCommand(packageManager, token), [packageManager, token]);
  const currentOutput = tab === "source" ? source : token;
  const sidePanelOpen = configOpen || resultOpen;

  const togglePanel = (panel: Panel) => {
    if (panel === "config") {
      setConfigOpen((current) => !current);
      if (!desktop) setResultOpen(false);
      return;
    }

    setResultOpen((current) => !current);
    if (!desktop) setConfigOpen(false);
  };

  const selectPackageManager = (value: string) => {
    const manager = value as PackageManager;

    setPackageManager(manager);
    if (manager !== "pnpm") setInstallPrompt(manager);
  };

  return (
    <div className="relative flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-night-1000 text-ghost-100">
      <header className="z-30 flex h-12 shrink-0 items-center gap-2 border-b border-line-subtle bg-night-900 px-2 sm:px-3">
        <button
          type="button"
          title={configOpen ? "Close configuration" : "Open configuration"}
          aria-label={configOpen ? "Close configuration" : "Open configuration"}
          aria-pressed={configOpen}
          onClick={() => togglePanel("config")}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-control text-fg-muted hover:bg-surface-900 hover:text-gold-200"
        >
          {configOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
        </button>
        <Link
          href="/"
          aria-label="JIT home"
          title="Back to JIT"
          className="hidden h-8 items-center border-r border-line-subtle pr-3 sm:flex"
        >
          <JitLogo className="[&_img]:size-6 [&_span]:text-base" />
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <Code2 aria-hidden className="size-4 shrink-0 text-gold-200" />
          <span className="truncate font-mono text-xs text-ghost-100">Artifact Lab</span>
          <span className="hidden font-mono text-[10px] uppercase text-fg-subtle md:inline">schema.ts</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className={`hidden max-w-72 truncate sm:block ${statusColor(status)}`}>{message}</span>
          <button
            type="button"
            onClick={generate}
            disabled={status === "working" || dts === null}
            className="inline-flex h-8 items-center justify-center gap-2 rounded-control bg-gold-200 px-3 text-xs font-semibold text-night-900 hover:bg-gold-100 disabled:cursor-wait disabled:opacity-60"
          >
            <PackageCheck className="size-3.5" />
            <span className="hidden sm:inline">{status === "working" ? "Generating" : "Generate"}</span>
          </button>
          <button
            type="button"
            title={resultOpen ? "Close generated output" : "Open generated output"}
            aria-label={resultOpen ? "Close generated output" : "Open generated output"}
            aria-pressed={resultOpen}
            onClick={() => togglePanel("result")}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-control text-fg-muted hover:bg-surface-900 hover:text-gold-200"
          >
            {resultOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {sidePanelOpen && !desktop && (
          <button
            type="button"
            aria-label="Close side panel"
            onClick={() => {
              setConfigOpen(false);
              setResultOpen(false);
            }}
            className="absolute inset-0 z-30 cursor-default bg-black/55 backdrop-blur-[1px]"
          />
        )}

        {configOpen && (
          <aside className="absolute inset-y-0 left-0 z-40 flex w-[min(19rem,88vw)] shrink-0 flex-col border-r border-line bg-night-900 shadow-2xl lg:relative lg:z-10 lg:w-64 lg:shadow-none">
            <ConfigPanel
              fileName={fileName}
              outputRoot={outputRoot}
              format={format}
              packageManager={packageManager}
              onFileName={setFileName}
              onOutputRoot={setOutputRoot}
              onFormat={(value) => setFormat(value as AotOutputFormat)}
              onPackageManager={selectPackageManager}
              onClose={() => setConfigOpen(false)}
              mobile={!desktop}
            />
          </aside>
        )}

        <main className="flex min-w-0 flex-1 flex-col bg-night-950">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line-subtle bg-night-900 px-3">
            <FileCode2 aria-hidden className="size-3.5 text-info" />
            <span className="font-mono text-[11px] text-ghost-200">schema.ts</span>
            <span className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] text-fg-subtle">
              <LockKeyhole aria-hidden className="size-3" />
              import managed
            </span>
          </div>
          <div className="min-h-0 flex-1">
            {dts ? (
              <Editor
                height="100%"
                path="file:///lab/schema.ts"
                defaultLanguage="typescript"
                theme="jit-night"
                value={`${FIXED_PREFIX}${body}`}
                onChange={(value) => setBody(readLabBody(value ?? ""))}
                beforeMount={beforeMount}
                onMount={(editor, monaco) => {
                  monacoRef.current = monaco;
                  editor.createDecorationsCollection([
                    {
                      range: new monaco.Range(1, 1, 1, FIXED_IMPORT.length + 1),
                      options: {
                        isWholeLine: true,
                        className: "lab-managed-import",
                        glyphMarginClassName: "lab-managed-glyph",
                        glyphMarginHoverMessage: { value: "Managed by Artifact Lab" },
                      },
                    },
                  ]);
                  editor.onKeyDown((event) => {
                    const selection = editor.getSelection();
                    const key = event.browserEvent.key;
                    const mutates =
                      key.length === 1 ||
                      key === "Backspace" ||
                      key === "Delete" ||
                      key === "Enter" ||
                      ((event.browserEvent.ctrlKey || event.browserEvent.metaKey) &&
                        (key.toLowerCase() === "v" || key.toLowerCase() === "x"));
                    const joinsManagedPrefix =
                      key === "Backspace" && selection?.startLineNumber === 3 && selection.startColumn === 1;

                    if (selection && ((selection.startLineNumber <= 2 && mutates) || joinsManagedPrefix)) {
                      event.preventDefault();
                      event.stopPropagation();
                    }
                  });
                }}
                options={editorOptions}
                loading={<EditorLoading label="Loading editor" />}
              />
            ) : (
              <EditorLoading label="Loading JIT types" />
            )}
          </div>
        </main>

        {resultOpen && (
          <aside className="absolute inset-y-0 right-0 z-40 flex w-[min(36rem,94vw)] shrink-0 flex-col border-l border-line bg-night-900 shadow-2xl lg:relative lg:z-10 lg:w-[clamp(22rem,34vw,34rem)] lg:shadow-none">
            <ResultPanel
              compiled={compiled}
              selectedFile={selectedFile}
              source={source}
              tab={tab}
              token={token}
              report={report}
              format={format}
              command={command}
              currentOutput={currentOutput}
              status={status}
              message={message}
              copied={copied}
              onSelectFile={setSelectedFile}
              onTab={setTab}
              onCopy={copyToClipboard}
              onClose={() => setResultOpen(false)}
              mobile={!desktop}
            />
          </aside>
        )}
      </div>

      {installPrompt && (
        <CliInstallDialog
          manager={installPrompt}
          copied={copied}
          onCopy={copyToClipboard}
          onClose={() => setInstallPrompt(null)}
        />
      )}
    </div>
  );
}

interface ConfigPanelProps {
  readonly fileName: string;
  readonly outputRoot: string;
  readonly format: AotOutputFormat;
  readonly packageManager: PackageManager;
  readonly onFileName: (value: string) => void;
  readonly onOutputRoot: (value: string) => void;
  readonly onFormat: (value: string) => void;
  readonly onPackageManager: (value: string) => void;
  readonly onClose: () => void;
  readonly mobile: boolean;
}

function ConfigPanel({
  fileName,
  outputRoot,
  format,
  packageManager,
  onFileName,
  onOutputRoot,
  onFormat,
  onPackageManager,
  onClose,
  mobile,
}: ConfigPanelProps) {
  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line-subtle px-3">
        <Settings2 aria-hidden className="size-4 text-gold-200" />
        <h2 className="font-mono text-xs font-semibold text-ghost-100">Build settings</h2>
        {mobile && <PanelCloseButton label="Close configuration" onClick={onClose} />}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          <LabeledInput label="File name" value={fileName} onChange={onFileName} />
          <LabeledInput label="Output directory" value={outputRoot} onChange={onOutputRoot} />
          <LabeledSelect label="Format" value={format} onChange={onFormat} options={formatOptions} />
          <LabeledSelect
            label="Package manager"
            value={packageManager}
            onChange={onPackageManager}
            options={packageManagerOptions}
          />
        </div>

        <div className="mt-6 border-t border-line-subtle pt-4">
          <span className="mb-2 block font-mono text-[10px] uppercase text-fg-subtle">Output contract</span>
          <dl className="space-y-2 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-fg-subtle">Module</dt>
              <dd className="font-mono text-ghost-200">{format === "typescript" ? ".ts" : ".js"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-subtle">Runtime imports</dt>
              <dd className="font-mono text-success">zero</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-subtle">Integrity</dt>
              <dd className="font-mono text-ghost-200">Ed25519</dd>
            </div>
          </dl>
        </div>
      </div>
      <Link
        href="/"
        className="flex h-10 shrink-0 items-center gap-2 border-t border-line-subtle px-4 font-mono text-[11px] text-fg-muted hover:bg-night-850 hover:text-ghost-100"
      >
        <Home aria-hidden className="size-3.5" />
        Back to JIT
      </Link>
    </>
  );
}

interface ResultPanelProps {
  readonly compiled: LabCompilerResult | undefined;
  readonly selectedFile: string;
  readonly source: string;
  readonly tab: OutputTab;
  readonly token: string;
  readonly report: PublishedArtifact | undefined;
  readonly format: AotOutputFormat;
  readonly command: string;
  readonly currentOutput: string;
  readonly status: Status;
  readonly message: string;
  readonly copied: boolean;
  readonly onSelectFile: (path: string) => void;
  readonly onTab: (tab: OutputTab) => void;
  readonly onCopy: (value: string) => void;
  readonly onClose: () => void;
  readonly mobile: boolean;
}

function ResultPanel({
  compiled,
  selectedFile,
  source,
  tab,
  token,
  report,
  format,
  command,
  currentOutput,
  status,
  message,
  copied,
  onSelectFile,
  onTab,
  onCopy,
  onClose,
  mobile,
}: ResultPanelProps) {
  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line-subtle px-2">
        <div className="flex gap-1" role="tablist" aria-label="Generated artifact">
          <Tab active={tab === "source"} onClick={() => onTab("source")} icon={<FileCode2 />}>
            Output
          </Tab>
          <Tab active={tab === "token"} onClick={() => onTab("token")} icon={<ShieldCheck />}>
            Reconstruct
          </Tab>
        </div>
        <button
          type="button"
          title="Copy current result"
          aria-label="Copy current result"
          disabled={!currentOutput}
          onClick={() => currentOutput && onCopy(currentOutput)}
          className="ml-auto inline-flex size-8 items-center justify-center rounded-control text-fg-muted hover:bg-surface-900 hover:text-gold-200 disabled:opacity-30"
        >
          {copied ? <Check className="size-4 text-success" /> : <Clipboard className="size-4" />}
        </button>
        {mobile && <PanelCloseButton label="Close generated output" onClick={onClose} />}
      </div>

      <div className="min-h-0 flex-1">
        {tab === "source" ? (
          <div className="flex h-full min-h-0 flex-col">
            {compiled && compiled.files.length > 1 && (
              <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line-subtle px-2 py-1.5">
                {compiled.files.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => onSelectFile(file.path)}
                    className={
                      selectedFile === file.path
                        ? "shrink-0 rounded-control bg-surface-900 px-2.5 py-1 font-mono text-[11px] text-gold-200"
                        : "shrink-0 rounded-control px-2.5 py-1 font-mono text-[11px] text-fg-muted hover:text-ghost-100"
                    }
                  >
                    {file.path}
                  </button>
                ))}
              </div>
            )}
            {source ? (
              <div className="min-h-0 flex-1">
                <Editor
                  height="100%"
                  path={`file:///lab/output/${selectedFile || "output.ts"}`}
                  defaultLanguage={selectedFile.endsWith(".ts") ? "typescript" : "javascript"}
                  theme="jit-night"
                  value={source}
                  options={{ ...editorOptions, readOnly: true, lineNumbers: "off", glyphMargin: false }}
                  loading={<EditorLoading label="Loading output" />}
                />
              </div>
            ) : (
              <EmptyOutput />
            )}
          </div>
        ) : (
          <TokenPanel token={token} report={report} command={command} copied={copied} onCopy={onCopy} />
        )}
      </div>

      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-line-subtle px-3 py-2">
        <span className={`truncate ${statusColor(status)}`}>{message}</span>
        <span className="font-mono text-[10px] text-fg-muted">
          {report ? `${report.files} files · ${formatBytes(report.bytes)}` : format}
        </span>
      </div>
    </>
  );
}

function TokenPanel({
  token,
  report,
  command,
  copied,
  onCopy,
}: {
  readonly token: string;
  readonly report: PublishedArtifact | undefined;
  readonly command: string;
  readonly copied: boolean;
  readonly onCopy: (value: string) => void;
}) {
  if (!token || !report) return <EmptyOutput label="Generate an artifact to create its reconstruction token." />;

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="flex items-start gap-3 border-b border-line-subtle pb-4">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-control bg-success/10 text-success">
          <ShieldCheck aria-hidden className="size-4.5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ghost-100">Signed artifact ready</h3>
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">
            The CLI verifies the signature and digest before writing any file.
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2 border-b border-line-subtle py-4 text-xs">
        <dt className="text-fg-subtle">Digest</dt>
        <dd className="truncate font-mono text-ghost-200" title={report.hash}>
          {report.hash}
        </dd>
        <dt className="text-fg-subtle">Files</dt>
        <dd className="font-mono text-ghost-200">{report.files}</dd>
        <dt className="text-fg-subtle">Payload</dt>
        <dd className="font-mono text-ghost-200">{formatBytes(report.bytes)}</dd>
      </dl>

      <CopyBlock
        label="Project command"
        value={command}
        copied={copied}
        onCopy={onCopy}
        icon={<TerminalSquare aria-hidden />}
      />
      <CopyBlock
        label="Reconstruction token"
        value={token}
        copied={copied}
        onCopy={onCopy}
        icon={<ShieldCheck aria-hidden />}
        tall
      />
    </div>
  );
}

function CopyBlock({
  label,
  value,
  copied,
  onCopy,
  icon,
  tall = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly copied: boolean;
  readonly onCopy: (value: string) => void;
  readonly icon: React.ReactElement<{ className?: string }>;
  readonly tall?: boolean;
}) {
  return (
    <div className="mt-4">
      <span className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase text-fg-subtle">
        <span className="[&>svg]:size-3">{icon}</span>
        {label}
      </span>
      <button
        type="button"
        onClick={() => onCopy(value)}
        className="group flex w-full items-start gap-2 border border-line-subtle bg-night-1000 p-3 text-left hover:border-line-gold"
      >
        <code
          className={`min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap wrap-break-word font-mono text-[11px] leading-relaxed text-ghost-200 ${
            tall ? "max-h-40" : "max-h-24"
          }`}
        >
          {value}
        </code>
        {copied ? (
          <Check className="size-3.5 shrink-0 text-success" />
        ) : (
          <Clipboard className="size-3.5 shrink-0 text-fg-muted group-hover:text-gold-200" />
        )}
      </button>
    </div>
  );
}

function CliInstallDialog({
  manager,
  copied,
  onCopy,
  onClose,
}: {
  readonly manager: Exclude<PackageManager, "pnpm">;
  readonly copied: boolean;
  readonly onCopy: (value: string) => void;
  readonly onClose: () => void;
}) {
  const install = devInstallCommand(manager);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cli-install-title"
      className="fixed inset-0 z-70 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-md border border-line bg-night-900 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line-subtle px-4 py-3">
          <TerminalSquare aria-hidden className="size-4 text-gold-200" />
          <h2 id="cli-install-title" className="font-mono text-sm font-semibold text-ghost-100">
            Install the project CLI
          </h2>
          <PanelCloseButton label="Close CLI installation" onClick={onClose} />
        </div>
        <div className="p-4">
          <p className="text-sm leading-relaxed text-fg-muted">
            Pin <code className="font-mono text-ghost-200">@jit-compiler/cli</code> as a development dependency so every
            machine reconstructs artifacts with the same CLI version.
          </p>
          <button
            type="button"
            onClick={() => onCopy(install)}
            className="mt-4 flex w-full items-center gap-3 border border-line-subtle bg-night-1000 p-3 text-left hover:border-line-gold"
          >
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-ghost-200">
              {install}
            </code>
            {copied ? (
              <Check className="size-4 shrink-0 text-success" />
            ) : (
              <Clipboard className="size-4 shrink-0 text-fg-muted" />
            )}
          </button>
          <p className="mt-3 text-xs leading-relaxed text-fg-subtle">
            The token command shown after generation uses this local executable. The CLI verifies the site signature,
            checks the SHA-256 digest and only then writes into the configured project directory.
          </p>
        </div>
        <div className="flex justify-end border-t border-line-subtle px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-control bg-gold-200 px-4 text-xs font-semibold text-night-900 hover:bg-gold-100"
          >
            Continue
          </button>
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
      "editor.lineHighlightBackground": "#171b25",
    },
  });
}

function readLabBody(source: string): string {
  if (source.startsWith(FIXED_PREFIX)) return source.slice(FIXED_PREFIX.length);

  const lines = source.split("\n");
  return lines.slice(Math.min(2, lines.length)).join("\n");
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
  if (manager === "pnpm") return `pnpm exec jit-artifact add ${token}`;
  if (manager === "yarn") return `yarn exec jit-artifact add ${token}`;
  if (manager === "bun") return `bun run jit-artifact add ${token}`;
  return `npm exec -- jit-artifact add ${token}`;
}

function devInstallCommand(manager: PackageManager): string {
  if (manager === "pnpm") return "pnpm add -D @jit-compiler/cli";
  if (manager === "yarn") return "yarn add --dev @jit-compiler/cli";
  if (manager === "bun") return "bun add --dev @jit-compiler/cli";
  return "npm install --save-dev @jit-compiler/cli";
}

function statusColor(status: Status): string {
  if (status === "error") return "font-mono text-[11px] text-danger";
  if (status === "ready") return "font-mono text-[11px] text-success";
  return "font-mono text-[11px] text-fg-muted";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function EmptyOutput({
  label = "Generate the schema to inspect its specialized output.",
}: {
  readonly label?: string;
}) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center px-8 text-center">
      <FileCode2 aria-hidden className="mb-3 size-5 text-fg-subtle" />
      <p className="max-w-64 text-xs leading-relaxed text-fg-subtle">{label}</p>
    </div>
  );
}

function EditorLoading({ label }: { readonly label: string }) {
  return (
    <div className="flex h-full min-h-48 items-center justify-center bg-night-950 font-mono text-xs text-fg-subtle">
      {label}
    </div>
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
      <span className="mb-1.5 block font-mono text-[10px] uppercase text-fg-subtle">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full border border-line bg-night-1000 px-2.5 font-mono text-xs text-ghost-100 outline-none transition-colors hover:border-line-gold focus:border-gold-300 focus:ring-2 focus:ring-gold-300/15"
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
  readonly options: readonly SelectOption[];
}) {
  return (
    <div>
      <span className="mb-1.5 block font-mono text-[10px] uppercase text-fg-subtle">{label}</span>
      <Select value={value} onValueChange={onChange} options={options} ariaLabel={label} />
    </div>
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

function PanelCloseButton({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="ml-auto inline-flex size-8 items-center justify-center rounded-control text-fg-muted hover:bg-surface-900 hover:text-ghost-100"
    >
      <X aria-hidden className="size-4" />
    </button>
  );
}
