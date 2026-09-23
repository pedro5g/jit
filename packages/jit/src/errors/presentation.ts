import type { ErrorLocale } from "./locale.js";
import { enUS } from "./locale.js";
import { type IssueDescriptor, JITValidationError } from "./validation-error.js";

/** A validation issue after its message has been selected for presentation. */
export interface FormattedIssue extends IssueDescriptor {
  readonly message: string;
}

/** Presentation options for `JIT.error.format()`. */
export interface FormatOptions {
  /** Locale used when no per-issue formatter is supplied. */
  readonly locale?: ErrorLocale;
  /** Optional formatter that takes precedence over the locale for each issue. */
  readonly issue?: (issue: IssueDescriptor) => string;
}

/** HTTP/form-friendly validation output. */
export interface FlattenedError {
  /** Presented messages attached to the root value. */
  readonly formErrors: readonly string[];
  /** Presented messages grouped by the first property in each issue path. */
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;
}

/** Tree node used by form and UI integrations. */
export interface ErrorTreeNode {
  /** Presented issues whose paths end at this node. */
  readonly errors: readonly string[];
  /** Child nodes keyed by property name or array index. */
  readonly properties: Readonly<Record<string, ErrorTreeNode>>;
}

function isIssue(value: unknown): value is IssueDescriptor {
  if (typeof value !== "object" || value === null) return false;
  const issue = value as { readonly path?: unknown; readonly code?: unknown; readonly message?: unknown };
  return (
    Array.isArray(issue.path) &&
    typeof issue.code === "string" &&
    (issue.message === undefined || typeof issue.message === "string")
  );
}

/** Extracts canonical issues from a validation error without exposing rejected values. */
export function issues(error: unknown): readonly IssueDescriptor[] {
  if (error instanceof JITValidationError) return error.issues;
  if (typeof error !== "object" || error === null) return Object.freeze([]);

  const candidate = (error as { readonly issues?: unknown }).issues;
  if (!Array.isArray(candidate)) return Object.freeze([]);
  return Object.freeze(candidate.filter(isIssue));
}

/** Formats issues with a locale or a one-off issue formatter. */
export function format(error: unknown, options: FormatOptions = {}): readonly FormattedIssue[] {
  const locale = options.locale ?? enUS;
  return Object.freeze(
    issues(error).map((issue) =>
      Object.freeze({
        ...issue,
        message: options.issue?.(issue) ?? locale.format(issue),
      })
    )
  );
}

/** Flattens root and first-level field messages for HTTP/forms. */
export function flatten(error: unknown, options: FormatOptions = {}): FlattenedError {
  const formErrors: string[] = [];
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of format(error, options)) {
    const field = issue.path[0];
    if (field === undefined) formErrors.push(issue.message);
    else (fieldErrors[String(field)] ??= []).push(issue.message);
  }

  return Object.freeze({
    formErrors: Object.freeze(formErrors),
    fieldErrors: Object.freeze(
      Object.fromEntries(Object.entries(fieldErrors).map(([key, value]) => [key, Object.freeze(value)]))
    ),
  });
}

/** Builds a hierarchical issue tree for UI consumers. */
export function tree(error: unknown, options: FormatOptions = {}): ErrorTreeNode {
  const root: MutableTreeNode = { errors: [], properties: {} };

  for (const issue of format(error, options)) {
    let node = root;
    if (issue.path.length === 0) node.errors.push(issue.message);
    else {
      for (const segment of issue.path) {
        const key = String(segment);
        node.properties[key] ??= { errors: [], properties: {} };
        node = node.properties[key];
      }
      node.errors.push(issue.message);
    }
  }

  return freezeTree(root);
}

/** Produces a compact human-readable representation for logs and CLIs. */
export function pretty(error: unknown, options: FormatOptions = {}): string {
  return format(error, options)
    .map((issue) => `${formatPath(issue.path)}${formatPath(issue.path) === "" ? "" : ": "}${issue.message}`)
    .join("\n");
}

function formatPath(path: readonly PropertyKey[]): string {
  let output = "";
  for (const segment of path) {
    if (typeof segment === "number") output += `[${segment}]`;
    else output += `${output === "" ? "" : "."}${String(segment)}`;
  }
  return output;
}

interface MutableTreeNode {
  errors: string[];
  properties: Record<string, MutableTreeNode>;
}

function freezeTree(node: MutableTreeNode): ErrorTreeNode {
  return Object.freeze({
    errors: Object.freeze([...node.errors]),
    properties: Object.freeze(
      Object.fromEntries(Object.entries(node.properties).map(([key, child]) => [key, freezeTree(child)]))
    ),
  });
}
