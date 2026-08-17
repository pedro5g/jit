"use client";

import { ChevronDown, ChevronRight, FilePlus2, FileText, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { buildTree, nameOf, parentOf, type TreeNode, type WorkspaceProject } from "@/lib/workspace/project";

/**
 * The project, as a shape a reader can change.
 *
 * The tree is not decoration: it is what the CLI reconstructs. A directory
 * made here becomes a directory in their repository, so the explorer is the
 * declaration and everything below is a view of it.
 */

interface Pending {
  kind: "file" | "directory" | "rename";
  /** Directory the new entry goes in, for a creation. */
  parent: string;
  /** Entry being renamed. */
  target?: string;
  value: string;
}

export function FileTree({
  project,
  onOpen,
  onCreateFile,
  onCreateDirectory,
  onRename,
  onDelete,
}: {
  project: WorkspaceProject;
  onOpen: (path: string) => void;
  onCreateFile: (path: string) => void;
  onCreateDirectory: (path: string) => void;
  onRename: (from: string, to: string) => void;
  onDelete: (path: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<Pending | null>(null);

  const toggle = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const commit = () => {
    if (!pending) return;
    const value = pending.value.trim();

    if (!value) {
      setPending(null);
      return;
    }

    if (pending.kind === "rename" && pending.target) {
      // renaming edits the name, never the directory it sits in
      onRename(pending.target, join(parentOf(pending.target), value));
    } else {
      const path = join(pending.parent, value);
      if (pending.kind === "file") onCreateFile(path.endsWith(".ts") ? path : `${path}.ts`);
      else onCreateDirectory(path);
    }

    setPending(null);
  };

  const renderNodes = (nodes: TreeNode[], depth: number): React.ReactNode =>
    nodes.map((node) => {
      const renaming = pending?.kind === "rename" && pending.target === node.path;

      if (node.kind === "file") {
        return (
          <li key={node.path}>
            {renaming ? (
              <NameInput
                pending={pending}
                depth={depth}
                onChange={setPending}
                onCommit={commit}
                onCancel={() => setPending(null)}
              />
            ) : (
              <Row
                depth={depth}
                active={project.activePath === node.path}
                icon={<FileText aria-hidden className="size-3 shrink-0 text-fg-subtle" />}
                label={node.name}
                onClick={() => onOpen(node.path)}
                onRename={() => setPending({ kind: "rename", parent: "", target: node.path, value: node.name })}
                onDelete={() => onDelete(node.path)}
              />
            )}
          </li>
        );
      }

      const isCollapsed = collapsed.has(node.path);

      return (
        <li key={node.path}>
          {renaming ? (
            <NameInput
              pending={pending}
              depth={depth}
              onChange={setPending}
              onCommit={commit}
              onCancel={() => setPending(null)}
            />
          ) : (
            <Row
              depth={depth}
              active={false}
              icon={
                isCollapsed ? (
                  <ChevronRight aria-hidden className="size-3 shrink-0 text-fg-subtle" />
                ) : (
                  <ChevronDown aria-hidden className="size-3 shrink-0 text-fg-subtle" />
                )
              }
              label={node.name}
              directory
              onClick={() => toggle(node.path)}
              onAddFile={() => setPending({ kind: "file", parent: node.path, value: "" })}
              onAddDirectory={() => setPending({ kind: "directory", parent: node.path, value: "" })}
              onRename={() => setPending({ kind: "rename", parent: "", target: node.path, value: node.name })}
              onDelete={() => onDelete(node.path)}
            />
          )}

          {!isCollapsed && (
            <ul>
              {renderNodes(node.children, depth + 1)}
              {pending && pending.kind !== "rename" && pending.parent === node.path && (
                <li>
                  <NameInput
                    pending={pending}
                    depth={depth + 1}
                    onChange={setPending}
                    onCommit={commit}
                    onCancel={() => setPending(null)}
                  />
                </li>
              )}
            </ul>
          )}
        </li>
      );
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line-subtle px-2 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wide text-fg-subtle">project</span>
        <span className="ml-auto flex items-center gap-0.5">
          <IconButton
            label="New file"
            onClick={() => setPending({ kind: "file", parent: "", value: "" })}
            icon={<FilePlus2 aria-hidden className="size-3.5" />}
          />
          <IconButton
            label="New directory"
            onClick={() => setPending({ kind: "directory", parent: "", value: "" })}
            icon={<FolderPlus aria-hidden className="size-3.5" />}
          />
        </span>
      </div>

      <nav aria-label="Project files" className="min-h-0 flex-1 overflow-y-auto py-1">
        <ul>
          {renderNodes(buildTree(project), 0)}
          {pending && pending.kind !== "rename" && pending.parent === "" && (
            <li>
              <NameInput
                pending={pending}
                depth={0}
                onChange={setPending}
                onCommit={commit}
                onCancel={() => setPending(null)}
              />
            </li>
          )}
        </ul>
      </nav>
    </div>
  );
}

function join(parent: string, name: string): string {
  return parent === "" ? name : `${parent}/${name}`;
}

function Row({
  depth,
  active,
  icon,
  label,
  directory,
  onClick,
  onAddFile,
  onAddDirectory,
  onRename,
  onDelete,
}: {
  depth: number;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  directory?: boolean;
  onClick: () => void;
  onAddFile?: () => void;
  onAddDirectory?: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`group flex items-center gap-1 pr-1 transition-colors ${
        active ? "bg-gold-200/10 text-gold-200" : "text-fg-muted hover:bg-surface-800/60"
      }`}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left">
        {icon}
        <span className={`truncate font-mono text-[11px] ${directory ? "text-ghost-100" : ""}`}>{label}</span>
      </button>

      <span className="flex items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        {onAddFile && (
          <IconButton
            label={`New file in ${label}`}
            onClick={onAddFile}
            icon={<FilePlus2 aria-hidden className="size-3" />}
          />
        )}
        {onAddDirectory && (
          <IconButton
            label={`New directory in ${label}`}
            onClick={onAddDirectory}
            icon={<FolderPlus aria-hidden className="size-3" />}
          />
        )}
        <IconButton label={`Rename ${label}`} onClick={onRename} icon={<Pencil aria-hidden className="size-3" />} />
        <IconButton label={`Delete ${label}`} onClick={onDelete} icon={<Trash2 aria-hidden className="size-3" />} />
      </span>
    </div>
  );
}

/** The one row that is an input: naming something new, or renaming one. */
function NameInput({
  pending,
  depth,
  onChange,
  onCommit,
  onCancel,
}: {
  pending: Pending;
  depth: number;
  onChange: (pending: Pending) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center py-0.5" style={{ paddingLeft: `${depth * 12 + 8}px` }}>
      <input
        // biome-ignore lint/a11y/noAutofocus: the row exists because the reader just asked to type in it
        autoFocus
        value={pending.value}
        aria-label={pending.kind === "directory" ? "Directory name" : "File name"}
        placeholder={pending.kind === "directory" ? "schemas" : "user-schemas.ts"}
        spellCheck={false}
        onChange={(event) => onChange({ ...pending, value: event.target.value })}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (event.key === "Enter") onCommit();
          if (event.key === "Escape") onCancel();
        }}
        className="w-full rounded-control border border-line-gold/60 bg-night-1000 px-1.5 py-0.5 font-mono text-[11px] text-fg outline-none"
      />
    </div>
  );
}

function IconButton({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="inline-flex size-5 items-center justify-center rounded text-fg-subtle transition-colors hover:text-gold-200"
    >
      {icon}
    </button>
  );
}

export { nameOf };
