import type { ThemeRegistration } from "shiki";
import { codeToHtml } from "shiki";

/** Custom Shiki theme using the JIT syntax palette (design system §3.4). */
const jitNight: ThemeRegistration = {
  name: "jit-night",
  type: "dark",
  colors: {
    "editor.background": "#00000000",
    "editor.foreground": "#e8e2c5",
  },
  settings: [
    { settings: { foreground: "#e8e2c5" } },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#6f777b" } },
    {
      scope: ["keyword", "storage.type", "storage.modifier", "keyword.control"],
      settings: { foreground: "#c69cff" },
    },
    {
      scope: [
        "entity.name.type",
        "support.type",
        "support.class",
        "entity.other.inherited-class",
        "entity.name.namespace",
      ],
      settings: { foreground: "#7db7ff" },
    },
    {
      scope: ["entity.name.function", "support.function", "meta.function-call entity.name.function"],
      settings: { foreground: "#f7d27e" },
    },
    { scope: ["string", "string.quoted", "punctuation.definition.string"], settings: { foreground: "#9dd8a8" } },
    { scope: ["constant.numeric", "constant.language", "constant.other"], settings: { foreground: "#ffb86b" } },
    { scope: ["keyword.operator"], settings: { foreground: "#e8e2c5" } },
    { scope: ["variable", "variable.parameter", "meta.object-literal.key"], settings: { foreground: "#f3efd1" } },
    { scope: ["punctuation"], settings: { foreground: "#aeb2b3" } },
    { scope: ["invalid", "invalid.illegal"], settings: { foreground: "#ef7181" } },
  ],
};

export type HighlightLang = "ts" | "js" | "bash" | "json" | "text";

export async function highlight(code: string, lang: HighlightLang = "ts"): Promise<string> {
  return codeToHtml(code.trim(), { lang, theme: jitNight });
}
