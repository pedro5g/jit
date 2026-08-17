"use client";

import { FileCode2, Loader2, PackageCheck, ShieldCheck } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { CopyButton } from "@/components/code/copy-button";
import { Select } from "@/components/ui/select";
import type { LabCompilerRequest, LabCompilerResponse, LabCompilerResult } from "@/lib/lab/compiler/worker-types";
import { type PublishedArtifact, publishArtifact } from "@/lib/lab/registry/client";
import { bundleUnits, topLevelNames } from "@/lib/workspace/bundle";
import { compilationOrder, parentOf, type WorkspaceProject } from "@/lib/workspace/project";
import { Field, PanelBody, PanelToolbar, Tab } from "./panel-parts";
import type { EditorHandle } from "./workspace-editor";

const COMPILER_TIMEOUT_MS = 5_000;

type Status = "idle" | "working" | "ready" | "error";

interface GeneratedFile {
  path: string;
  source: string;
  /** The workspace file it was compiled from. */
  from: string;
}

/**
 * Turns the project in the editor into the import-free modules a repository
 * would ship, then signs them so the tree can be pulled into a real project
 * with one command.
 *
 * One compilation per file rather than one for the whole project: the layout
 * the reader declared is the layout that lands, so `schemas/user.ts` generates
 * `schemas/user.ts` and not a single flattened module with everything in it.
 */
export function GeneratePanel({ project, editor }: { project: WorkspaceProject; editor: EditorHandle | null }) {
  const [outputRoot, setOutputRoot] = useState("src/generated/jit");
  const [format, setFormat] = useState<"ts" | "js">("ts");
  const [packageManager, setPackageManager] = useState("pnpm");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [generated, setGenerated] = useState<GeneratedFile[]>([]);
  const [skipped, setSkipped] = useState<LabCompilerResult["skipped"]>([]);
  const [selected, setSelected] = useState("");
  const [published, setPublished] = useState<PublishedArtifact>();
  const [tab, setTab] = useState<"source" | "install">("source");

  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);

  const generate = useCallback(async () => {
    if (!editor) return;

    setStatus("working");
    setPublished(undefined);

    try {
      const worker = new Worker(new URL("../../lib/lab/compiler/worker.ts", import.meta.url));
      workerRef.current?.terminate();
      workerRef.current = worker;

      const files: GeneratedFile[] = [];
      const skips: LabCompilerResult["skipped"][number][] = [];

      for (const file of project.files) {
        setMessage(`Type-checking ${file.path}`);
        const diagnostic = await editor.firstDiagnostic(file.path);
        if (diagnostic) throw new Error(`${file.path}: ${diagnostic}`);

        const names = topLevelNames(file.source);
        // a file that declares nothing generates nothing, which is not an error
        if (names.length === 0) continue;

        setMessage(`Compiling ${file.path}`);
        // dependencies first, each in a scope of its own, so two files may use
        // the same name and an import still means what it says
        const units = compilationOrder(project, file.path);
        const transpiled = await Promise.all(
          units.map(async (unit) => ({ path: unit.path, code: await editor.transpile(unit.path, unit.source) }))
        );

        const result = await compile(worker, ++requestId.current, {
          code: bundleUnits(transpiled),
          names,
          options: { format, fileName: file.path },
        });

        for (const output of result.files) files.push({ ...output, from: file.path });
        skips.push(...result.skipped);
      }

      if (files.length === 0) {
        throw new Error(skips[0]?.reason ?? "No compiled functions were found in this project");
      }

      setMessage("Signing the artifact");
      const artifact = await publishArtifact(
        files.map((file) => ({ path: file.path, source: file.source })),
        outputRoot
      );

      setGenerated(files);
      setSkipped(skips);
      setSelected(files[0]?.path ?? "");
      setPublished(artifact);
      setStatus("ready");
      setMessage(`${files.length} file${files.length === 1 ? "" : "s"} in ${directoryCount(files)} directories`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Generation failed");
    }
  }, [editor, format, outputRoot, project]);

  const source = generated.find((file) => file.path === selected)?.source ?? "";
  const command = published ? installCommand(packageManager, published.token) : "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelToolbar>
        <div className="w-36">
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
          {status === "working" ? "Generating" : "Generate"}
        </button>
        {message && (
          <span className={`truncate font-mono text-[11px] ${status === "error" ? "text-danger" : "text-fg-subtle"}`}>
            {message}
          </span>
        )}
      </PanelToolbar>

      <PanelBody>
        <Field
          label="output directory"
          value={outputRoot}
          onChange={setOutputRoot}
          hint="where the CLI writes the tree, relative to the project root"
        />

        {generated.length > 0 && (
          <>
            <div className="flex shrink-0 items-center gap-1 border-b border-line-subtle">
              <Tab active={tab === "source"} onClick={() => setTab("source")} label="generated tree" />
              <Tab active={tab === "install"} onClick={() => setTab("install")} label="pull into a project" />
              <span className="ml-auto pb-1">
                <CopyButton text={tab === "source" ? source : command} label="Copy" />
              </span>
            </div>

            {tab === "install" ? (
              <div className="flex flex-col gap-2">
                <div className="w-36">
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
                <OutputTree files={generated} outputRoot={outputRoot} />
                <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-fg-muted">
                  <ShieldCheck aria-hidden className="mt-0.5 size-3 shrink-0 text-success" />
                  The reference is signed and content-addressed. The CLI verifies the signature and every digest before
                  it writes a file, creates only the directories above, and leaves anything else in {outputRoot}{" "}
                  untouched.
                </p>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <ul className="flex shrink-0 flex-wrap gap-1">
                  {generated.map((file) => (
                    <li key={file.path}>
                      <button
                        type="button"
                        onClick={() => setSelected(file.path)}
                        title={`compiled from ${file.from}`}
                        className={`inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                          file.path === selected
                            ? "border-line-gold text-gold-200"
                            : "border-line-subtle text-fg-subtle hover:text-ghost-100"
                        }`}
                      >
                        <FileCode2 aria-hidden className="size-2.5" />
                        {file.path}
                      </button>
                    </li>
                  ))}
                </ul>

                <pre className="min-h-32 flex-1 overflow-auto rounded-control border border-line-subtle bg-night-1000/60 p-3 font-mono text-[12px] leading-relaxed text-ghost-100">
                  <code>{source}</code>
                </pre>
              </div>
            )}

            {skipped.length > 0 && (
              <ul className="flex flex-col gap-1 rounded-control border border-warning/30 p-2">
                {skipped.map((skip) => (
                  <li key={skip.schema + skip.operation} className="text-[11px] text-warning">
                    <span className="font-mono">{skip.schema}</span> · {skip.operation}: {skip.reason}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {generated.length === 0 && status !== "working" && (
          <p className="rounded-control border border-line-subtle bg-night-1000/40 p-3 text-[11px] leading-relaxed text-fg-muted">
            Generate compiles every file in the project into an import-free module, keeping the directories you
            declared. It is the same output <code className="font-mono text-ghost-200">jit generate</code> writes in a
            repository, and jit itself never ships to production.
          </p>
        )}
      </PanelBody>
    </div>
  );
}

/** The output as the directory tree the CLI will create. */
function OutputTree({ files, outputRoot }: { files: GeneratedFile[]; outputRoot: string }) {
  const directories = [...new Set(files.map((file) => parentOf(file.path)).filter(Boolean))].sort();

  return (
    <div className="rounded-control border border-line-subtle bg-night-1000/40 p-3 font-mono text-[11px] text-fg-muted">
      <p className="text-ghost-100">{outputRoot}/</p>
      {directories.map((directory) => (
        <p key={directory} className="pl-3 text-ghost-200">
          {directory}/
        </p>
      ))}
      {files.map((file) => (
        <p key={file.path} className={parentOf(file.path) ? "pl-6" : "pl-3"}>
          {file.path.slice(parentOf(file.path) ? parentOf(file.path).length + 1 : 0)}
        </p>
      ))}
    </div>
  );
}

function directoryCount(files: GeneratedFile[]): number {
  return new Set(files.map((file) => parentOf(file.path))).size;
}

/** One compilation, with the worker terminated if it does not come back. */
function compile(worker: Worker, id: number, request: Omit<LabCompilerRequest, "id">): Promise<LabCompilerResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error(`Compilation exceeded ${COMPILER_TIMEOUT_MS} ms`));
    }, COMPILER_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<LabCompilerResponse>) => {
      if (event.data.id !== id) return;
      clearTimeout(timer);
      if (event.data.ok) resolve(event.data.result);
      else reject(new Error(event.data.error));
    };
    worker.onerror = () => {
      clearTimeout(timer);
      reject(new Error("The AOT compiler worker crashed"));
    };

    worker.postMessage({ ...request, id } satisfies LabCompilerRequest);
  });
}

function installCommand(manager: string, token: string): string {
  if (manager === "pnpm") return `pnpm dlx @jit-compiler/cli add ${token}`;
  if (manager === "yarn") return `yarn dlx @jit-compiler/cli add ${token}`;
  if (manager === "bun") return `bunx @jit-compiler/cli add ${token}`;
  return `npx @jit-compiler/cli add ${token}`;
}
