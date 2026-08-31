/**
 * Every name the answer wrote, checked against what exists — §PART 14.
 *
 * The check this replaces looked only at `JIT.x`. Two thirds of the surface
 * lives below that — `JIT.validate.safeParse`, `.min()`, `.uuid()` — and two
 * thirds of the inventions did too: `JIT.compare.deepEqual`,
 * `JIT.security.redact` and `.notEmpty()` are all names a reader would paste
 * into an editor, and all names the old assistant waved through because it
 * stopped reading at the first dot.
 *
 * Deterministic, and the one place in this system where "does that exist?" has
 * an exact answer. The target is not that the model stops inventing names; it
 * is that an invented name never reaches a screen.
 */
import type { AnswerValidator, AuditContext, AuditFinding } from "../../../core/entities/audit";
import { scanJitExpressions } from "../../../core/value-objects/jit-expression";

/**
 * Language and platform methods a jit example legitimately calls.
 *
 * Short on purpose. Being too strict here is worse than being too loose: a
 * banner that fires on a correct `.map()` teaches the reader to ignore the one
 * that fires on an invented `.run()`.
 */
const BUILTIN_METHODS = new Set([
  "map",
  "filter",
  "reduce",
  "forEach",
  "push",
  "slice",
  "join",
  "split",
  "then",
  "catch",
  "finally",
  "toString",
  "valueOf",
  "stringify",
  "parse",
  "log",
  "warn",
  "error",
  "info",
  "keys",
  "values",
  "entries",
  "has",
  "get",
  "set",
  "add",
  "delete",
  "test",
  "replace",
  "trim",
  "includes",
  "startsWith",
  "endsWith",
  "toISOString",
  "now",
  "from",
  "of",
  "all",
  "resolve",
  "reject",
]);

export const inventedSymbolValidator: AnswerValidator = {
  name: "invented-symbol",

  validate({ answer, symbols }: AuditContext): AuditFinding[] {
    const roots = new Set<string>();
    const members = new Set<string>();
    const methods = new Map<string, string>();

    for (const expression of scanJitExpressions(answer)) {
      /**
       * A lowercase root needs a call before it can be judged.
       *
       * `jit.config.ts` is a real filename and `jit generate` is a real
       * command, so a bare `jit.something` in prose is not necessarily a claim
       * about the API. Models write the root both ways, though, and
       * `await jit.generate({ inputSchema })` — an API that exists in no
       * casing — passed every check while the scan was anchored to `JIT.`.
       */
      if (expression.lowercase && expression.calls.length === 0 && !expression.member) continue;

      const root = `JIT.${expression.root}`;
      if (!symbols.findByPath(root)) {
        roots.add(root);
        continue;
      }

      if (expression.member && !symbols.findByPath(`${root}.${expression.member}`)) {
        members.add(`${root}.${expression.member}`);
        continue;
      }

      for (const call of expression.calls) {
        if (BUILTIN_METHODS.has(call)) continue;
        // Scoped to the factory the chain started from, which is the one place
        // the schema kind is known for certain.
        if (symbols.findByPath(`${root}.${call}`)) continue;

        // A name that is a real method somewhere is a *wrong kind* rather than
        // an invention, and saying which kinds it is valid on is far more
        // useful than saying it does not exist.
        const elsewhere = symbols.findExact(call);
        methods.set(
          `.${call}()`,
          elsewhere && elsewhere.validOn.length > 0
            ? `.${call}() is not valid on ${expression.root}; it is valid on ${elsewhere.validOn.join(", ")}`
            : `.${call}() is not a method on ${expression.root}`
        );
      }
    }

    const findings: AuditFinding[] = [];
    const report = (offenders: string[], detail: string) =>
      findings.push({
        kind: "invented-symbol",
        severity: "fatal",
        // The evidence was there and correct; the model wrote a name that is
        // not in it. Nothing upstream could have prevented this.
        origin: "model_failure",
        detail,
        offenders,
        source: "invented-symbol",
      });

    if (roots.size > 0) {
      report([...roots], `${[...roots].join(", ")} ${roots.size === 1 ? "is" : "are"} not part of the library.`);
    }
    if (members.size > 0) {
      report(
        [...members],
        `${[...members].join(", ")} ${members.size === 1 ? "does" : "do"} not exist on that namespace.`
      );
    }
    if (methods.size > 0) {
      report([...methods.keys()], `${[...methods.values()].join(". ")}.`);
    }

    return findings;
  },
};
