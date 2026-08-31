/**
 * Technology the answer drifted into — §PART 18.
 *
 * A model that has lost the thread reaches for whatever its training data
 * associates with the words in front of it, and "query" plus "data engine" is
 * enough to produce `User.query('SELECT * FROM users WHERE id = ?')` in the
 * middle of an answer about compiling schemas. jit has no database, no
 * connection and no SQL, so this has a very clear fingerprint — and it is
 * worth naming exactly, because a reader who sees SQL assumes the library has
 * a data layer they have not found yet.
 *
 * The list stays short: only what the transcripts actually produced. A long
 * blacklist is a maintenance burden that eventually fires on a legitimate
 * comparison — the documentation does discuss zod and typia, and an answer
 * comparing against them is doing its job.
 */
import type { AnswerValidator, AuditContext, AuditFinding } from "../../../core/entities/audit";

const FOREIGN: [pattern: RegExp, name: string][] = [
  [/\b(?:SELECT|INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b[\s\S]{0,60}\bFROM\b|\bSELECT\s+\*/i, "SQL"],
  [/\b(?:mongoose|prisma|sequelize|knex|typeorm|drizzle)\b/i, "another ORM"],
  [/\b(?:createConnection|getRepository|\.collection\(|\.findOne\(|\.aggregate\(\[)/, "a database client"],
  [/\b(?:express|fastify|useState|useEffect|createSlice)\s*\(/, "an unrelated framework"],
];

/** Fenced blocks in a language where jit code would live. */
function scriptBlocks(answer: string): string[] {
  return [...answer.matchAll(/```(?:ts|tsx|typescript|js|jsx|javascript)?\n([\s\S]*?)```/gi)].map((match) => match[1]);
}

export const foreignDomainValidator: AnswerValidator = {
  name: "foreign-domain",

  validate({ answer, modelContext }: AuditContext): AuditFinding[] {
    const blocks = scriptBlocks(answer);
    if (blocks.length === 0) return [];

    const code = blocks.join("\n");
    const evidence = modelContext.evidence.map((item) => item.content).join("\n");

    for (const [pattern, name] of FOREIGN) {
      if (!pattern.test(code)) continue;
      // The documentation does compare against other tools. A mention the
      // evidence itself contains is a comparison, not a drift.
      if (pattern.test(evidence)) continue;

      return [
        {
          kind: "foreign-domain-drift",
          severity: "fatal",
          origin: "model_failure",
          detail: `The example contains ${name}, which has nothing to do with jit — jit compiles schemas, it is not a database or a framework.`,
          offenders: [name],
          source: "foreign-domain",
        },
      ];
    }

    /**
     * An example that never calls the library.
     *
     * Asked why jit is fast, a model once answered with hand-written
     * JavaScript — `user.id !== undefined && typeof user.name === "string"` —
     * presented as the library in action. Every name in it is correct, because
     * there are no names in it. The reader copies it and has written jit out
     * of their own program.
     *
     * Only when *no* block uses jit: an answer contrasting hand-written code
     * with the jit version is doing something useful, and does it by showing
     * both.
     */
    if (blocks.some((block) => /\bJIT\./.test(block))) return [];

    return [
      {
        kind: "foreign-domain-drift",
        severity: "warning",
        origin: "model_failure",
        detail:
          "The example is plain JavaScript that never calls jit, so it does not show the reader how to do anything with the library.",
        offenders: [],
        source: "foreign-domain",
      },
    ];
  },
};
