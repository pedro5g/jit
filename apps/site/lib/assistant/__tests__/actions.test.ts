import { describe, expect, it } from "vitest";
import {
  type AssistantAction,
  codeActionFrom,
  demoActionFor,
  deriveActions,
  mergeActions,
  parseActions,
  planActions,
  workspaceActionFor,
} from "../actions";
import type { DocSection, RetrievedSection } from "../types";

function source(overrides: Partial<DocSection> = {}): RetrievedSection {
  return {
    section: {
      url: "/docs/runtime/queries#filtering",
      page: "Queries",
      description: "",
      heading: "Filtering",
      breadcrumb: "Queries › Filtering",
      kind: "runtime",
      depth: 2,
      part: 0,
      text: "…",
      ...overrides,
    },
    score: 1,
    lexical: 1,
    semantic: 0,
  };
}

describe("parseActions", () => {
  it("lifts a navigation out of the prose", () => {
    const { text, actions } = parseActions("Use safeParse at the boundary. [[go:/docs/runtime/validation]]");

    expect(text).toBe("Use safeParse at the boundary.");
    expect(actions).toEqual([{ kind: "navigate", url: "/docs/runtime/validation", label: "Validation" }]);
  });

  it("names an anchored destination with its section", () => {
    const { actions } = parseActions("[[go:/docs/runtime/queries#filtering]]");

    expect(actions[0]).toMatchObject({ kind: "navigate", label: "Queries · filtering" });
  });

  it("turns a show tag into a pointing action", () => {
    const { actions } = parseActions("It is right here. [[show:Binary rowsets]]");

    expect(actions).toEqual([{ kind: "highlight", heading: "Binary rowsets", label: 'Point at "Binary rowsets"' }]);
  });

  it("refuses a destination outside the site", () => {
    const { actions, text } = parseActions("[[go:https://evil.example/steal]] read this");

    expect(actions).toEqual([]);
    expect(text).toBe("read this");
  });

  it("refuses a path that is not part of the app", () => {
    expect(parseActions("[[go:/api/lab/keys/abc]]").actions).toEqual([]);
  });

  /**
   * A model that invents an API name invents a path with it, and the invented
   * one outranks what retrieval found — which is how "why is jit fast" ended
   * up on the schema factories page.
   */
  it("refuses a page it was not shown", () => {
    const context = { knownPages: new Set(["/docs/runtime/validation"]) };

    expect(parseActions("[[go:/docs/reference/functions/schema-factories]]", context).actions).toEqual([]);
  });

  it("accepts a page it was shown, anchor and all", () => {
    const context = { knownPages: new Set(["/docs/runtime/validation"]) };
    const { actions } = parseActions("[[go:/docs/runtime/validation#compiled-validation]]", context);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "navigate" });
  });

  it("trusts every safe path when no context is given", () => {
    expect(parseActions("[[go:/docs/anything]]").actions).toHaveLength(1);
  });

  it("never repeats the same destination twice", () => {
    const { actions } = parseActions("[[go:/docs/quick-start]] and again [[go:/docs/quick-start]]");

    expect(actions).toHaveLength(1);
  });

  /** The tag arrives one token at a time; a partial one must not be shown. */
  it("holds back a tag that is still streaming", () => {
    expect(parseActions("Take a look at this [[go:/docs/qui").text).toBe("Take a look at this");
    expect(parseActions("Take a look at this [[go:/docs/qui").actions).toEqual([]);
  });

  it("leaves ordinary bracketed citations alone", () => {
    const { text } = parseActions("As described in [1] and [2].");

    expect(text).toBe("As described in [1] and [2].");
  });
});

describe("deriveActions", () => {
  it("offers to navigate when the answer lives on another page", () => {
    expect(deriveActions([source()], "/docs/quick-start")).toEqual([
      { kind: "navigate", url: "/docs/runtime/queries#filtering", label: "Take me to Queries · filtering" },
    ]);
  });

  it("points instead of navigating when the reader is already there", () => {
    const actions = deriveActions([source()], "/docs/runtime/queries");

    expect(actions).toEqual([{ kind: "highlight", heading: "Filtering", label: 'Point at "Filtering"' }]);
  });

  it("offers nothing when retrieval found nothing", () => {
    expect(deriveActions([], "/docs")).toEqual([]);
  });

  /** Retrieval can miss a question the concept graph still recognises. */
  it("falls back to where the graph would send them", () => {
    expect(deriveActions([], "/docs", "/docs/reference/functions/mask")).toEqual([
      { kind: "navigate", url: "/docs/reference/functions/mask", label: "Take me to Mask" },
    ]);
  });

  it("does not offer the page the reader is already on", () => {
    expect(deriveActions([], "/docs/reference/functions/mask", "/docs/reference/functions/mask")).toEqual([]);
  });
});

describe("mergeActions", () => {
  it("keeps the model's action and adds what it missed", () => {
    const fromModel = parseActions("[[show:Filtering]]").actions;
    const merged = mergeActions(fromModel, deriveActions([source()], "/docs/quick-start"));

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ kind: "highlight" });
  });

  it("does not repeat a destination the model already offered", () => {
    const fromModel = parseActions("[[go:/docs/runtime/queries#filtering]]").actions;
    const merged = mergeActions(fromModel, deriveActions([source()], "/docs/quick-start"));

    expect(merged).toHaveLength(1);
  });

  it("caps how many buttons an answer can grow", () => {
    const many = parseActions(
      "[[go:/docs/a]] [[go:/docs/b]] [[go:/docs/c]] [[go:/docs/d]] [[go:/docs/e]] [[go:/docs/f]]"
    ).actions;

    expect(mergeActions(many, []).length).toBeLessThanOrEqual(4);
  });
});

describe("workspaceActionFor", () => {
  it("offers to run a jit snippet", () => {
    const action = workspaceActionFor("const isUser = JIT.validate.is(User);", "ts");

    expect(action).toMatchObject({ kind: "workspace", mode: "run" });
  });

  it("offers the schema itself to the generator", () => {
    const action = workspaceActionFor("const User = JIT.object({ id: JIT.number() });", "ts");

    expect(action).toMatchObject({ kind: "workspace", mode: "generate" });
  });

  it("ignores a block that is not jit source", () => {
    expect(workspaceActionFor("pnpm add @jit-compiler/jit", "sh")).toBeNull();
    expect(workspaceActionFor('{ "id": 1 }', "json")).toBeNull();
    expect(workspaceActionFor("const total = items.length;", "ts")).toBeNull();
  });
});

describe("planActions", () => {
  const navigate: AssistantAction = { kind: "navigate", url: "/docs/runtime/queries", label: "Queries" };
  const highlight: AssistantAction = { kind: "highlight", heading: "Filtering", label: 'Point at "Filtering"' };
  const write: AssistantAction = { kind: "workspace", code: "const A = JIT.string();", mode: "run", label: "Run it" };

  it("points without asking, wherever the reader is", () => {
    expect(planActions([highlight], "/docs/quick-start").auto).toEqual([highlight]);
    expect(planActions([highlight], "/workspace").auto).toEqual([highlight]);
  });

  /**
   * The default that used to be backwards. A reader who asks a question wants
   * it answered, not to be moved: navigating replaces the page they are on,
   * including the answer they are halfway through reading. So the destination
   * becomes a link in the conversation, and the reader decides.
   */
  it("offers the destination instead of navigating, when nobody asked to go", () => {
    const plan = planActions([navigate], "/docs/quick-start");

    expect(plan.auto).toEqual([]);
    expect(plan.offered).toEqual([navigate]);
  });

  it("navigates when the reader actually asked to be taken somewhere", () => {
    const plan = planActions([navigate], "/docs/quick-start", { readerAskedToNavigate: true });

    expect(plan.auto).toEqual([navigate]);
    expect(plan.offered).toEqual([]);
  });

  /** Pulling someone out of an open editor is the one autonomous move that hurts. */
  it("never navigates away from the workspace, even when asked", () => {
    const plan = planActions([navigate], "/workspace", { readerAskedToNavigate: true });

    expect(plan.auto).toEqual([]);
    expect(plan.offered).toEqual([navigate]);
  });

  it("offers rather than repeats a navigation to the page already open", () => {
    const plan = planActions([navigate], "/docs/runtime/queries", { readerAskedToNavigate: true });

    expect(plan.auto).toEqual([]);
    expect(plan.offered).toEqual([navigate]);
  });

  it("writes into the editor when the editor is on screen", () => {
    expect(planActions([write], "/workspace?mode=run").auto).toEqual([write]);
  });

  it("only offers to write when following it would leave the page", () => {
    const plan = planActions([write], "/docs/quick-start");

    expect(plan.auto).toEqual([]);
    expect(plan.offered).toEqual([write]);
  });

  it("splits a mixed answer into what it did and what it offers", () => {
    const plan = planActions([highlight, navigate, write], "/docs/quick-start");

    // pointing is free and happens; the link and the editor write are offered
    expect(plan.auto).toEqual([highlight]);
    expect(plan.offered).toEqual([navigate, write]);
  });
});

describe("codeActionFrom", () => {
  it("turns the schema in an answer into a write the editor can receive", () => {
    const answer = [
      "Declare it once and compile the guard:",
      "```ts",
      "const User = JIT.object({ id: JIT.number() });",
      "const isUser = JIT.validate.is(User);",
      "```",
    ].join("\n");

    expect(codeActionFrom(answer)).toMatchObject({ kind: "workspace", mode: "run" });
  });

  /**
   * Answers explain with a fragment and then show the real thing. Writing each
   * block in turn would leave the editor holding whichever came last.
   */
  it("writes the complete block, not the fragment that explained it", () => {
    const answer = [
      "`is` is the guard:",
      "```ts",
      "JIT.validate.is(User);",
      "```",
      "In full:",
      "```ts",
      "const User = JIT.object({ id: JIT.number(), name: JIT.string() });",
      "const isUser = JIT.validate.is(User);",
      "```",
    ].join("\n");

    expect(codeActionFrom(answer)?.kind === "workspace" && codeActionFrom(answer)).toMatchObject({
      code: expect.stringContaining("name: JIT.string()"),
    });
  });

  it("ignores an answer with no jit code in it", () => {
    expect(codeActionFrom("Run `pnpm add @jit-compiler/jit` first.")).toBeNull();
    expect(codeActionFrom("```sh\npnpm add @jit-compiler/jit\n```")).toBeNull();
  });

  it("ignores a block that is still streaming, since it has no closing fence", () => {
    expect(codeActionFrom("```ts\nconst User = JIT.object({")).toBeNull();
  });

  /** The whole point: in the workspace, a written schema is applied. */
  it("reaches the editor when the reader is in the workspace", () => {
    const written = codeActionFrom("```ts\nconst User = JIT.object({ id: JIT.number() });\n```");
    const plan = planActions(written ? [written] : [], "/workspace");

    expect(plan.auto).toHaveLength(1);
    expect(plan.offered).toEqual([]);
  });
});

describe("demoActionFor", () => {
  const written = codeActionFrom("```ts\nconst User = JIT.object({ id: JIT.number() });\n```");

  it("offers to rewrite the example on the page the reader is reading", () => {
    expect(demoActionFor(written, "/docs/runtime/validation")).toMatchObject({
      kind: "demo",
      label: "Show it in this page",
    });
  });

  it("offers nothing where there is no example to rewrite", () => {
    expect(demoActionFor(written, "/workspace")).toBeNull();
    expect(demoActionFor(written, "/")).toBeNull();
  });

  it("offers nothing when the answer carried no code", () => {
    expect(demoActionFor(null, "/docs/quick-start")).toBeNull();
  });

  /**
   * Rewriting the page is always a click. Documentation a reader cannot tell
   * apart from a model's suggestion is worth less than the demonstration gains.
   */
  it("is never carried out unasked", () => {
    const demo = demoActionFor(written, "/docs/quick-start");
    const plan = planActions(demo ? [demo] : [], "/docs/quick-start");

    expect(plan.auto).toEqual([]);
    expect(plan.offered).toHaveLength(1);
  });

  it("does not crowd out the write the workspace would take", () => {
    const demo = demoActionFor(written, "/docs/quick-start");
    const merged = mergeActions(
      [written, demo].filter((action) => action !== null),
      []
    );

    expect(merged.map((action) => action.kind)).toEqual(["workspace", "demo"]);
  });
});
