"use client";

import { Loader2, PackageCheck, ShieldCheck } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { CopyButton } from "@/components/code/copy-button";
import { Select } from "@/components/ui/select";
import type { LabCompilerRequest, LabCompilerResponse, LabCompilerResult } from "@/lib/lab/compiler/worker-types";
import { type PublishedArtifact, publishArtifact } from "@/lib/lab/registry/client";
import { Field, PanelBody, PanelToolbar, Tab } from "./panel-parts";
import type { EditorHandle } from "./workspace-editor";

const COMPILER_TIMEOUT_MS = 5_000;

type Status = "idle" | "working" | "ready" | "error";

/**
 * Turns the schema in the editor into the import-free module a project would
 * ship, then signs it so it can be pulled into a real repository with one
 * command — the same AOT path the CLI runs, executed in a browser worker.
 */
export function GeneratePanel({ code, editor }: { code: string; editor: EditorHandle | null }) {
  const [fileName, setFileName] = useState("schemas.generated");
  const [outputRoot, setOutputRoot] = useState("src/generated/jit");
  const [format, setFormat] = useState<"ts" | "js">("ts");
  const [packageManager, setPackageManager] = useState("pnpm");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [compiled, setCompiled] = useState<LabCompilerResult>();
  const [selectedFile, setSelectedFile] = useState("");
  const [published, setPublished] = useState<PublishedArtifact>();
  const [tab, setTab] = useState<"source" | "install">("source");

  const workerRef = useRef<Worker | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);

  const generate = useCallback(async () => {
    if (!editor) return;

    setStatus("working");
    setMessage("Type-checking");

    try {
      const diagnostic = await editor.firstDiagnostic();
      if (diagnostic) throw new Error(diagnostic);

      const names = collectTopLevelNames(code);
      if (names.length === 0) throw new Error("Declare at least one schema or compiled function");

      setMessage("Compiling");
      const js = await editor.transpile(code);

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
          reject(new Error("The AOT compiler worker crashed"));
        };

        worker.postMessage({ id, code: js, names, options: { format, fileName } } satisfies LabCompilerRequest);
      });

      if (result.files.length === 0) {
        throw new Error(result.skipped[0]?.reason ?? "No compiled functions were found");
      }

      setMessage("Signing the artifact");
      const artifact = await publishArtifact(result.files, outputRoot);

      setCompiled(result);
      setSelectedFile(result.files[0]?.path ?? "");
      setPublished(artifact);
      setStatus("ready");
      setMessage(`Generated ${result.files.length} file${result.files.length === 1 ? "" : "s"}`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Generation failed");
    }
  }, [code, editor, fileName, format, outputRoot]);

  const source = compiled?.files.find((file) => file.path === selectedFile)?.source ?? "";
  const command = published ? installCommand(packageManager, published.token) : "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelToolbar>
        <div className="w-40">
          <Select
            ariaLabel="Output format"
            value={format}
            onValueChange={(value) => setFormat(value as "ts" | "js")}
            options={[
              { value: "ts", label: "TypeScript", description: "Typed, import-free source" },
              { value: "js", label: "JavaScript", description: "Ready-to-run ESM" },
            ]}
          />
        </div>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={!editor || status === "working"}
          className="inline-flex items-center gap-1.5 rounded-control border border-line-gold/50 bg-gold-200/10 px-3 py-1.5 text-xs font-semibold text-gold-200 transition-colors hover:bg-gold-200/20 disabled:opacity-40"
        >
          {status === "working" ? (
            <Loader2 aria-hidden className="size-3 animate-spin" />
          ) : (
            <PackageCheck aria-hidden className="size-3" />
          )}
          {status === "working" ? message : "Generate"}
        </button>
        {status !== "working" && message && (
          <span className={`truncate font-mono text-[11px] ${status === "error" ? "text-danger" : "text-fg-subtle"}`}>
            {message}
          </span>
        )}
      </PanelToolbar>

      <PanelBody>
        <div className="grid shrink-0 gap-3 sm:grid-cols-2">
          <Field
            label="module name"
            value={fileName}
            onChange={setFileName}
            hint="the generated file, without an extension"
          />
          <Field
            label="output directory"
            value={outputRoot}
            onChange={setOutputRoot}
            hint="where the CLI will write it"
          />
        </div>

        {compiled && (
          <>
            <div className="flex shrink-0 items-center gap-1 border-b border-line-subtle">
              <Tab active={tab === "source"} onClick={() => setTab("source")} label="generated source" />
              <Tab active={tab === "install"} onClick={() => setTab("install")} label="pull into a project" />
              <span className="ml-auto pb-1">
                <CopyButton text={tab === "source" ? source : command} label="Copy" />
              </span>
            </div>

            {tab === "source" && compiled.files.length > 1 && (
              <div className="flex shrink-0 flex-wrap gap-1">
                {compiled.files.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => setSelectedFile(file.path)}
                    className={`rounded-pill border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                      file.path === selectedFile
                        ? "border-line-gold text-gold-200"
                        : "border-line-subtle text-fg-subtle hover:text-ghost-100"
                    }`}
                  >
                    {file.path}
                  </button>
                ))}
              </div>
            )}

            {tab === "install" ? (
              <div className="flex flex-col gap-2">
                <div className="w-40">
                  <Select
                    ariaLabel="Package manager"
                    value={packageManager}
                    onValueChange={setPackageManager}
                    options={[
                      { value: "pnpm", label: "pnpm" },
                      { value: "npm", label: "npm" },
                      { value: "yarn", label: "Yarn" },
                      { value: "bun", label: "Bun" },
                    ]}
                  />
                </div>
                <pre className="overflow-x-auto rounded-control border border-line-subtle bg-night-1000/60 p-3 font-mono text-[12px] text-ghost-100">
                  <code>{command}</code>
                </pre>
                <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-fg-muted">
                  <ShieldCheck aria-hidden className="mt-0.5 size-3 shrink-0 text-success" />
                  The reference is signed and content-addressed: the CLI verifies the signature and the hash before it
                  writes a single file into {outputRoot}.
                </p>
              </div>
            ) : (
              <pre className="min-h-32 flex-1 overflow-auto rounded-control border border-line-subtle bg-night-1000/60 p-3 font-mono text-[12px] leading-relaxed text-ghost-100">
                <code>{source}</code>
              </pre>
            )}

            {compiled.skipped.length > 0 && (
              <ul className="flex flex-col gap-1 rounded-control border border-warning/30 p-2">
                {compiled.skipped.map((skip) => (
                  <li key={skip.schema + skip.operation} className="text-[11px] text-warning">
                    <span className="font-mono">{skip.schema}</span> · {skip.operation}: {skip.reason}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {!compiled && status !== "working" && (
          <p className="rounded-control border border-line-subtle bg-night-1000/40 p-3 text-[11px] leading-relaxed text-fg-muted">
            Generate turns the declarations above into an import-free module — the same output{" "}
            <code className="font-mono text-ghost-200">jit generate</code> writes in a project. jit itself never ships
            to production.
          </p>
        )}
      </PanelBody>
    </div>
  );
}

/** The declarations the AOT compiler should look at. */
function collectTopLevelNames(source: string): string[] {
  const names = new Set<string>();
  const pattern = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;

  for (const match of source.matchAll(pattern)) {
    if (match[1]) names.add(match[1]);
  }

  return [...names];
}

function installCommand(manager: string, token: string): string {
  if (manager === "pnpm") return `pnpm dlx @jit-compiler/cli add ${token}`;
  if (manager === "yarn") return `yarn dlx @jit-compiler/cli add ${token}`;
  if (manager === "bun") return `bunx @jit-compiler/cli add ${token}`;
  return `npx @jit-compiler/cli add ${token}`;
}
