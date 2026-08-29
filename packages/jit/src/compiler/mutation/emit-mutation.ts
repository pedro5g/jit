import { CodeWriter } from "../emitter/code-writer.js";
import { emitPropertyAccess } from "../source/access.js";
import { emitObjectKey } from "../source/literal.js";
import {
  isDateLeaf,
  type MutationLevel,
  type MutationPlan,
  type MutationValue,
  type MutationWrite,
} from "./mutation-plan.js";

/**
 * Emits the body of a specialized mutation.
 *
 * The generated function reads each written field once, decides whether
 * anything changed, and only then allocates. A level whose subtree did not
 * change keeps its reference, so a mutation costs one object per changed level
 * — and a mutation that changes nothing costs none: it returns its input.
 */
export function emitMutationBody(plan: MutationPlan): string {
  const writer = new CodeWriter();

  if (plan.root === undefined) {
    writer.line("return value;");
    return writer.toString();
  }

  for (const name of plan.params) {
    writer.line(`const ${paramVar(name)} = params${emitPropertyAccess("", name)};`);
  }
  for (const [key, child] of plan.root.children) emitLevel(writer, child, emitPropertyAccess("value", key));

  const changed = emitLevelTests(writer, plan.root, "value");
  writer.line(`if (!(${changed})) return value;`);
  writer.line(`return ${emitReplacement(plan.root, "value")};`);

  return writer.toString();
}

/**
 * Declares one nested level: its reads, its change flag and its replacement.
 *
 * Children are emitted before their parent, so a parent decides what to carry
 * over from a flag that is already known rather than by looking again.
 */
function emitLevel(writer: CodeWriter, level: MutationLevel, source: string): void {
  const name = levelVar(level);
  const current = `${name}_value`;
  writer.line(`const ${current} = ${source};`);
  for (const [key, child] of level.children) emitLevel(writer, child, emitPropertyAccess(current, key));

  const changed = emitLevelTests(writer, level, current);
  writer.line(`const ${name}_changed = ${changed};`);
  // The replacement is a static-key object literal, built only on the branch
  // that already knows something below it changed.
  writer.line(`let ${name}_next = ${current};`);
  writer.line(`if (${name}_changed) ${name}_next = ${emitReplacement(level, current)};`);
}

/** Declares this level's written values and returns its change expression. */
function emitLevelTests(writer: CodeWriter, level: MutationLevel, current: string): string {
  const tests: string[] = [];

  for (const [key, write] of level.writes) {
    const next = `${levelVar(level)}_${safeName(key)}`;
    const previous = `${next}_previous`;
    writer.line(`const ${previous} = ${emitPropertyAccess(current, key)};`);
    writer.line(`const ${next} = ${emitWriteValue(write, previous)};`);
    tests.push(`${next} !== ${previous}`);
  }
  for (const child of level.children.values()) tests.push(`${levelVar(child)}_changed`);

  return tests.join(" || ");
}

function emitReplacement(level: MutationLevel, current: string): string {
  const entries = level.props.map((prop) => {
    if (level.writes.has(prop)) return `${emitObjectKey(prop)}: ${levelVar(level)}_${safeName(prop)}`;
    const child = level.children.get(prop);
    // A child's `_next` already holds its original reference when nothing
    // below it changed, so an unchanged branch needs no test here.
    if (child !== undefined) return `${emitObjectKey(prop)}: ${levelVar(child)}_next`;
    return `${emitObjectKey(prop)}: ${emitPropertyAccess(current, prop)}`;
  });
  return `{ ${entries.join(", ")} }`;
}

/**
 * The value one write produces, with the semantics a deep-partial patch has.
 *
 * An absent value is not a write, an identical value is not a change, and a
 * date is compared by instant and copied on write — the same three rules the
 * generic update follows, so specializing a patch cannot change what it means.
 */
function emitWriteValue(write: MutationWrite, previous: string): string {
  const source = emitValueSource(write.value);
  if (isDateLeaf(write.schema)) {
    return `${source} === undefined || Object.is(${source}, ${previous}) || ${previous}.getTime() === ${source}.getTime() ? ${previous} : new Date(${source}.getTime())`;
  }
  return `${source} === undefined || Object.is(${source}, ${previous}) ? ${previous} : ${source}`;
}

function emitValueSource(value: MutationValue): string {
  return value.kind === "param" ? paramVar(value.name) : `__q${value.index}`;
}

function paramVar(name: string): string {
  return `__p_${safeName(name)}`;
}

function levelVar(level: MutationLevel): string {
  return level.path.length === 0 ? "root" : `l_${level.path.map(safeName).join("_")}`;
}

function safeName(key: string): string {
  return key.replace(/[^A-Za-z0-9_$]/g, "_");
}
