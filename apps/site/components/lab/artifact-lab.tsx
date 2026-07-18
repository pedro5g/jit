"use client";

import { Check, Clipboard, Download, FileCode2, PackageCheck, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useCopy } from "@/hooks/use-copy";
import type { LabCompileResult, LabField, LabFieldType, LabOperation, LabStringFormat } from "@/lib/lab/types";
import { LAB_OPERATIONS } from "@/lib/lab/types";
import { type ArtifactReport, inspectArtifact, packArtifact } from "@/lib/lab/wasm";

interface EditableField extends LabField {
  readonly id: number;
}

type ArtifactTab = "schema" | "generated" | "token";

const fieldTypes: readonly { value: LabFieldType; label: string }[] = [
  { value: "string", label: "string" },
  { value: "integer", label: "int32" },
  { value: "number", label: "number" },
  { value: "boolean", label: "boolean" },
  { value: "stringArray", label: "string[]" },
];

const stringFormats: readonly { value: LabStringFormat; label: string }[] = [
  { value: "none", label: "plain" },
  { value: "email", label: "email" },
  { value: "uuid", label: "uuid" },
  { value: "url", label: "url" },
];

const defaultFields: readonly EditableField[] = [
  { id: 1, name: "id", type: "integer", required: true, min: 1 },
  { id: 2, name: "name", type: "string", required: true, min: 2, max: 80, format: "none" },
  { id: 3, name: "email", type: "string", required: true, format: "email" },
  { id: 4, name: "tags", type: "stringArray", required: false, max: 8 },
];

const defaultOperations: readonly LabOperation[] = ["is", "parse", "safeParse", "stringify"];

export function ArtifactLab() {
  const [name, setName] = useState("User");
  const [outputRoot, setOutputRoot] = useState("src/generated/jit");
  const [fields, setFields] = useState<readonly EditableField[]>(defaultFields);
  const [operations, setOperations] = useState<readonly LabOperation[]>(defaultOperations);
  const [compiled, setCompiled] = useState<LabCompileResult>();
  const [token, setToken] = useState("");
  const [report, setReport] = useState<ArtifactReport>();
  const [tab, setTab] = useState<ArtifactTab>("schema");
  const [status, setStatus] = useState<"idle" | "working" | "ready" | "error">("idle");
  const [message, setMessage] = useState("Ready");
  const { copied, copyToClipboard } = useCopy();
  const schemaPreview = useMemo(() => previewSchema(name, fields, operations), [name, fields, operations]);

  const updateField = (id: number, patch: Partial<LabField>) => {
    setFields((current) => current.map((field) => (field.id === id ? { ...field, ...patch } : field)));
  };

  const addField = () => {
    setFields((current) => [
      ...current,
      {
        id: current.reduce((maximum, field) => Math.max(maximum, field.id), 0) + 1,
        name: `field${current.length + 1}`,
        type: "string",
        required: true,
        format: "none",
      },
    ]);
  };

  const removeField = (id: number) => {
    setFields((current) => (current.length === 1 ? current : current.filter((field) => field.id !== id)));
  };

  const toggleOperation = (operation: LabOperation) => {
    setOperations((current) =>
      current.includes(operation) ? current.filter((value) => value !== operation) : [...current, operation]
    );
  };

  const generate = async () => {
    setStatus("working");
    setMessage("Compiling");

    try {
      const response = await fetch("/api/lab/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          outputRoot,
          fields: fields.map(({ id: _id, ...field }) => field),
          operations,
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(readApiError(payload));
      const result = payload as LabCompileResult;
      const packed = await packArtifact(result.files, outputRoot);

      setCompiled(result);
      setToken(packed.token);
      setReport(packed.report);
      setTab("generated");
      setStatus("ready");
      setMessage("Verified");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Compilation failed");
    }
  };

  const inspect = async () => {
    setStatus("working");
    setMessage("Verifying");

    try {
      const nextReport = await inspectArtifact(token.trim());
      setReport(nextReport);
      setStatus("ready");
      setMessage("Verified");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Invalid token");
    }
  };

  const download = () => {
    const blob = new Blob([`${token}\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${name.toLowerCase()}-jit-artifact.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const currentSource =
    tab === "schema"
      ? (compiled?.schemaSource ?? schemaPreview)
      : tab === "generated"
        ? compiled?.files[0]?.source
        : token;

  return (
    <div className="overflow-hidden border border-line bg-night-950 shadow-(--shadow-card)">
      <div className="flex flex-wrap items-end gap-4 border-b border-line-subtle bg-night-900 px-4 py-4 sm:px-5">
        <LabeledInput label="Export" value={name} onChange={setName} width="w-40" />
        <LabeledInput label="Output root" value={outputRoot} onChange={setOutputRoot} width="min-w-58 flex-1" />
        <button
          type="button"
          onClick={generate}
          disabled={status === "working"}
          className="inline-flex h-10 items-center gap-2 rounded-control bg-gold-200 px-4 text-sm font-semibold text-night-900 transition-colors hover:bg-gold-100 disabled:cursor-wait disabled:opacity-60"
        >
          <PackageCheck className="size-4" />
          Generate artifact
        </button>
      </div>

      <div className="grid min-h-155 lg:grid-cols-[minmax(25rem,0.92fr)_minmax(0,1.08fr)]">
        <div className="border-b border-line-subtle lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between border-b border-line-subtle px-4 py-3">
            <h2 className="font-mono text-sm font-semibold text-ghost-100">Schema fields</h2>
            <button
              type="button"
              onClick={addField}
              title="Add field"
              className="inline-flex size-8 items-center justify-center rounded-control border border-line text-fg-muted hover:border-line-gold hover:text-gold-200"
            >
              <Plus className="size-4" />
            </button>
          </div>

          <div className="divide-y divide-line-subtle">
            {fields.map((field) => (
              <div key={field.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_7rem_5.5rem_5.5rem_2rem]">
                <input
                  aria-label={`Field ${field.name} name`}
                  value={field.name}
                  onChange={(event) => updateField(field.id, { name: event.target.value })}
                  className={inputClass}
                />
                <select
                  aria-label={`Field ${field.name} type`}
                  value={field.type}
                  onChange={(event) => {
                    const type = event.target.value as LabFieldType;
                    updateField(field.id, {
                      type,
                      format: type === "string" ? (field.format ?? "none") : undefined,
                      min: type === "boolean" ? undefined : field.min,
                      max: type === "boolean" ? undefined : field.max,
                    });
                  }}
                  className={inputClass}
                >
                  {fieldTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
                <BoundInput
                  label={`Minimum for ${field.name}`}
                  placeholder="min"
                  value={field.min}
                  onChange={(min) => updateField(field.id, { min })}
                />
                <BoundInput
                  label={`Maximum for ${field.name}`}
                  placeholder="max"
                  value={field.max}
                  onChange={(max) => updateField(field.id, { max })}
                />
                <button
                  type="button"
                  title="Remove field"
                  onClick={() => removeField(field.id)}
                  disabled={fields.length === 1}
                  className="inline-flex size-8 items-center justify-center text-fg-subtle hover:text-danger disabled:opacity-30"
                >
                  <Trash2 className="size-4" />
                </button>
                <label className="inline-flex items-center gap-2 text-xs text-fg-muted">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(event) => updateField(field.id, { required: event.target.checked })}
                    className="accent-(--gold-200)"
                  />
                  required
                </label>
                {field.type === "string" && (
                  <select
                    aria-label={`Format for ${field.name}`}
                    value={field.format ?? "none"}
                    onChange={(event) => updateField(field.id, { format: event.target.value as LabStringFormat })}
                    className={`${inputClass} sm:col-span-2`}
                  >
                    {stringFormats.map((format) => (
                      <option key={format.value} value={format.value}>
                        {format.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>

          <fieldset className="border-t border-line-subtle px-4 py-4">
            <legend className="mb-3 font-mono text-sm font-semibold text-ghost-100">Compiled operations</legend>
            <div className="flex flex-wrap gap-2">
              {LAB_OPERATIONS.map((operation) => {
                const active = operations.includes(operation);
                return (
                  <button
                    type="button"
                    key={operation}
                    aria-pressed={active}
                    onClick={() => toggleOperation(operation)}
                    className={
                      active
                        ? "rounded-control border border-gold-300 bg-gold-300/10 px-3 py-1.5 font-mono text-xs text-gold-200"
                        : "rounded-control border border-line px-3 py-1.5 font-mono text-xs text-fg-muted hover:border-line-gold"
                    }
                  >
                    {operation}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>

        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-subtle px-4 py-3">
            <div className="flex gap-1" role="tablist" aria-label="Artifact output">
              <TabButton active={tab === "schema"} onClick={() => setTab("schema")} icon={<FileCode2 />}>
                Schema
              </TabButton>
              <TabButton active={tab === "generated"} onClick={() => setTab("generated")} icon={<PackageCheck />}>
                TypeScript
              </TabButton>
              <TabButton active={tab === "token"} onClick={() => setTab("token")} icon={<ShieldCheck />}>
                Token
              </TabButton>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                title="Copy current output"
                disabled={!currentSource}
                onClick={() => currentSource && copyToClipboard(currentSource)}
                className={iconButtonClass}
              >
                {copied ? <Check className="size-4 text-success" /> : <Clipboard className="size-4" />}
              </button>
              <button
                type="button"
                title="Download token"
                disabled={!token}
                onClick={download}
                className={iconButtonClass}
              >
                <Download className="size-4" />
              </button>
            </div>
          </div>

          {tab === "token" ? (
            <div className="flex flex-1 flex-col gap-3 p-4">
              <textarea
                aria-label="Artifact token"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                spellCheck={false}
                className="min-h-72 flex-1 resize-none border border-line bg-night-1000 p-3 font-mono text-xs leading-relaxed text-ghost-200 outline-none focus:border-line-gold"
              />
              <button
                type="button"
                onClick={inspect}
                disabled={!token.trim() || status === "working"}
                className="inline-flex h-9 w-fit items-center gap-2 rounded-control border border-line px-3 text-sm text-ghost-100 hover:border-line-gold disabled:opacity-50"
              >
                <ShieldCheck className="size-4" />
                Verify token
              </button>
            </div>
          ) : (
            <pre className="min-h-120 flex-1 overflow-auto bg-night-1000 p-4 font-mono text-xs leading-relaxed text-ghost-200">
              <code>{currentSource ?? "No output"}</code>
            </pre>
          )}

          <div className="grid gap-3 border-t border-line-subtle px-4 py-3 sm:grid-cols-[auto_1fr_auto] sm:items-center">
            <span
              className={
                status === "error"
                  ? "font-mono text-xs text-danger"
                  : status === "ready"
                    ? "font-mono text-xs text-success"
                    : "font-mono text-xs text-fg-muted"
              }
            >
              {message}
            </span>
            <span className="truncate font-mono text-xs text-fg-subtle">{report?.envelopeDigest ?? "No digest"}</span>
            <span className="font-mono text-xs text-fg-muted">
              {report ? `${report.files.length} files · ${formatBytes(report.originalBytes)}` : "jit1"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "h-8 min-w-0 border border-line bg-night-1000 px-2 font-mono text-xs text-ghost-100 outline-none focus:border-line-gold";
const iconButtonClass =
  "inline-flex size-8 items-center justify-center rounded-control text-fg-muted hover:bg-surface-900 hover:text-gold-200 disabled:opacity-30";

function LabeledInput({
  label,
  value,
  onChange,
  width,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly width: string;
}) {
  return (
    <label className={`${width} block`}>
      <span className="mb-1 block font-mono text-[11px] uppercase text-fg-subtle">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} className={`${inputClass} w-full`} />
    </label>
  );
}

function BoundInput({
  label,
  placeholder,
  value,
  onChange,
}: {
  readonly label: string;
  readonly placeholder: string;
  readonly value: number | undefined;
  readonly onChange: (value: number | undefined) => void;
}) {
  return (
    <input
      type="number"
      min={0}
      aria-label={label}
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
      className={inputClass}
    />
  );
}

function TabButton({
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

function previewSchema(name: string, fields: readonly EditableField[], operations: readonly LabOperation[]): string {
  const lines = fields.map((field) => `  ${field.name}: ${fieldSource(field)},`).join("\n");
  const selected = operations.map((operation) => `  ${operation}: true,`).join("\n");

  return `import { JIT } from "@jit-compiler/jit/define";

const ${name}Schema = JIT.object({
${lines}
});

export const ${name} = JIT.model(${name}Schema, {
${selected}
});

export type ${name}Value = JIT.Typeof<typeof ${name}Schema>;
`;
}

function fieldSource(field: LabField): string {
  let source =
    field.type === "string"
      ? "JIT.string()"
      : field.type === "integer"
        ? "JIT.number().int32()"
        : field.type === "number"
          ? "JIT.number()"
          : field.type === "boolean"
            ? "JIT.boolean()"
            : "JIT.array(JIT.string())";
  if (field.min !== undefined) source += `.min(${field.min})`;
  if (field.max !== undefined) source += `.max(${field.max})`;
  if (field.type === "string" && field.format && field.format !== "none") source += `.${field.format}()`;
  if (!field.required) source += ".optional()";
  return source;
}

function readApiError(payload: unknown): string {
  if (payload !== null && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  return "Unable to compile artifact";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
