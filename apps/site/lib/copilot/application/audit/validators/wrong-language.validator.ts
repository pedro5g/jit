/**
 * An answer in the wrong language — §PART 19.
 *
 * Not a hypothetical. In the headless benchmark the light model answered
 * Portuguese questions in English on a third of them, and a correct answer a
 * reader cannot read is not a correct answer. It is also a failure no other
 * validator sees: every name is real, every claim is grounded, and the whole
 * thing is useless to the person who asked.
 *
 * Code and API names are stripped before the check. `JIT.string().uuid()` is
 * the same in both languages, and a short Portuguese answer built around a
 * code block otherwise reads as English to any detector — which would flag
 * exactly the answers that got it right.
 */
import type { AnswerValidator, AuditContext, AuditFinding } from "../../../core/entities/audit";
import { detectLocale } from "../../../core/value-objects/locale";

/** Below this, there is not enough prose to judge and the check abstains. */
const ENOUGH_PROSE = 60;

export const wrongLanguageValidator: AnswerValidator = {
  name: "wrong-language",

  validate({ answer, locale }: AuditContext): AuditFinding[] {
    const prose = answer
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`[^`]*`/g, " ")
      .replace(/\bJIT\.[\w.()]*/g, " ")
      .replace(/\[\d+\]/g, " ")
      .trim();

    if (prose.length < ENOUGH_PROSE) return [];

    // The fallback is the expected locale, so an undecidable answer abstains
    // rather than being reported as wrong.
    const detected = detectLocale(prose, locale);
    if (detected === locale) return [];

    return [
      {
        kind: "wrong-language",
        // Fatal: §64 makes the question decide the language, and an answer the
        // reader cannot read fails completely rather than partially.
        severity: "fatal",
        origin: "language_failure",
        detail: `The reader asked in ${locale} and the answer is in ${detected}.`,
        offenders: [detected],
        source: "wrong-language",
      },
    ];
  },
};
