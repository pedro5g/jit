import { JIT } from "@jit-compiler/jit";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";

/**
 * Dependency-aware memoization, against the two shapes it replaces.
 *
 * Reference memoization asks whether the input object changed. A reselect-style
 * selector asks whether hand-named input selectors changed. A derived
 * computation knows which fields it reads, so it asks the narrowest question
 * available — and with a change mask it answers without reading the state.
 */
const AppState = JIT.object({
  user: JIT.object({ name: JIT.string(), status: JIT.string(), tags: JIT.array(JIT.string()) }),
  cart: JIT.object({ items: JIT.number(), total: JIT.number() }),
  session: JIT.object({ id: JIT.string(), lastSeen: JIT.number() }),
});

type State = {
  user: { name: string; status: string; tags: string[] };
  cart: { items: number; total: number };
  session: { id: string; lastSeen: number };
};

const base: State = {
  user: { name: "Ada", status: "active", tags: ["math"] },
  cart: { items: 2, total: 40 },
  session: { id: "s_1", lastSeen: 0 },
};

const header = JIT.state.derive(AppState).select("user.name", "user.status");
const memo = header.memo();

/** Recompute on every call: the baseline that never asks anything. */
const always = (state: State) => ({ name: state.user.name, status: state.user.status });

/** Reference memoization: cheap, but a new state object defeats it. */
const byReference = (() => {
  let previous: State | undefined;
  let result: { name: string; status: string } | undefined;
  return (state: State) => {
    if (state === previous && result !== undefined) return result;
    previous = state;
    result = { name: state.user.name, status: state.user.status };
    return result;
  };
})();

/** Reselect-style: hand-named input selectors, compared by reference. */
const byInputs = (() => {
  let previousName: string | undefined;
  let previousStatus: string | undefined;
  let result: { name: string; status: string } | undefined;
  return (state: State) => {
    const name = state.user.name;
    const status = state.user.status;
    if (name === previousName && status === previousStatus && result !== undefined) return result;
    previousName = name;
    previousStatus = status;
    result = { name, status };
    return result;
  };
})();

const unrelated: State = { ...base, cart: { items: 3, total: 60 } };
const relevant: State = { ...base, user: { ...base.user, name: "Grace" } };

// Prime every memo so the measured call is a steady-state call.
for (const selector of [memo, byReference, byInputs]) selector(base as never);

registerScenario({
  op: "derive",
  name: "same state reference",
  args: [base],
  jit: memo as (...args: never[]) => unknown,
  competitors: [
    { name: "recompute always", fn: always },
    { name: "memo by reference", fn: byReference },
    { name: "reselect-style input selectors", fn: byInputs },
  ],
});

registerScenario({
  op: "derive",
  name: "unrelated field changed",
  args: [unrelated],
  jit: memo as (...args: never[]) => unknown,
  competitors: [
    { name: "recompute always", fn: always },
    { name: "memo by reference", fn: byReference },
    { name: "reselect-style input selectors", fn: byInputs },
  ],
});

registerScenario({
  op: "derive",
  name: "unrelated field changed, with change mask",
  args: [unrelated, 2],
  jit: memo as (...args: never[]) => unknown,
  competitors: [
    { name: "reselect-style input selectors", fn: byInputs, biased: "has no mask to consult, so it reads the fields" },
  ],
});

registerScenario({
  op: "derive",
  name: "dependency changed",
  args: [relevant],
  jit: memo as (...args: never[]) => unknown,
  competitors: [
    { name: "recompute always", fn: always },
    { name: "reselect-style input selectors", fn: byInputs },
  ],
});

/**
 * Where the mechanism actually pays.
 *
 * A selector over a structural field has to compare that structure to know
 * whether it changed. A change mask says so without reading it, and the gap
 * widens with the size of the value rather than with the size of the selector.
 *
 * Each round builds a new state object, because a fixed argument would only
 * ever measure the same-reference hit.
 */
// The dependency is structural on purpose: a mask can only save the comparison
// it replaces, and comparing two scalars is already almost free.
const dataflowMemo = JIT.state.derive(AppState).select("user.name", "user.tags").memo();
const plainUpdate = JIT.state.update(AppState).compile();
const structuralMemo = JIT.state.derive(AppState).select("user.tags").memo();
const wideTags = Array.from({ length: 64 }, (_, index) => `tag-${index}`);
const withTags: State = { ...base, user: { ...base.user, tags: wideTags } };
const touchCart = JIT.state
  .update(AppState)
  .patch({ cart: { items: JIT.cqrs.param("items") } })
  .result({ value: true, changed: true })
  .compile();
const STRUCTURAL_ROUNDS = 50_000;

registerScenario({
  op: "derive",
  name: "50k unrelated changes, structural dependency",
  args: [withTags],
  jit: ((state: State) => {
    const selector = structuralMemo;
    let current = state;
    let last: unknown;
    for (let round = 0; round < STRUCTURAL_ROUNDS; round++) {
      const result = touchCart(current, { items: round });
      current = result.value as State;
      last = selector(current, result.changed);
    }
    return last;
  }) as (...args: never[]) => unknown,
  competitors: [
    {
      name: "handwritten structural comparison",
      fn: (state: State) => {
        let previous: readonly string[] | undefined;
        let result: { tags: readonly string[] } | undefined;
        let current = state;
        let last: unknown;
        for (let round = 0; round < STRUCTURAL_ROUNDS; round++) {
          current = plainUpdate(current, { cart: { items: round } }) as State;
          const tags = current.user.tags;
          let same = previous !== undefined && result !== undefined && previous.length === tags.length;
          if (same && previous !== tags) {
            for (let index = 0; index < tags.length; index++) {
              if (previous?.[index] !== tags[index]) {
                same = false;
                break;
              }
            }
          }
          if (!same || result === undefined) {
            previous = tags;
            result = { tags };
          }
          last = result;
        }
        return last;
      },
      biased: "has no mask to consult, so it reaches the dependency on every round",
    },
  ],
});

/**
 * The end-to-end question: how much application work is avoided.
 *
 * A hundred thousand updates, nine in ten touching a field the selector does
 * not read. The mutation reports what changed as part of doing the work, and
 * the selector consults that instead of comparing anything.
 */
const mutateUnrelated = JIT.state
  .update(AppState)
  .patch({ session: { lastSeen: JIT.cqrs.param("lastSeen") } })
  .result({ value: true, changed: true })
  .compile();
const mutateRelevant = JIT.state
  .update(AppState)
  .patch({ user: { name: JIT.cqrs.param("name") } })
  .result({ value: true, changed: true })
  .compile();
const ROUNDS = 100_000;

registerScenario({
  op: "dataflow",
  name: "100k updates, 10% touch the derived dependency",
  args: [withTags],
  jit: ((state: State) => {
    const selector = dataflowMemo;
    let current = state;
    let last: unknown;
    for (let round = 0; round < ROUNDS; round++) {
      const result =
        round % 10 === 0
          ? mutateRelevant(current, { name: `n${round}` })
          : mutateUnrelated(current, { lastSeen: round });
      current = result.value as State;
      last = selector(current, result.changed);
    }
    return last;
  }) as (...args: never[]) => unknown,
  competitors: [
    {
      name: "immutable update + reference memo",
      fn: (state: State) => {
        let previous: State | undefined;
        let result: { name: string; tags: readonly string[] } | undefined;
        let current = state;
        let last: unknown;
        for (let round = 0; round < ROUNDS; round++) {
          current = plainUpdate(
            current,
            round % 10 === 0 ? { user: { name: `n${round}` } } : { session: { lastSeen: round } }
          ) as State;
          if (current !== previous || result === undefined) {
            previous = current;
            result = { name: current.user.name, tags: current.user.tags };
          }
          last = result;
        }
        return last;
      },
    },
    {
      name: "immutable update + reselect-style selector",
      fn: (state: State) => {
        let previousName: string | undefined;
        let previousTags: readonly string[] | undefined;
        let result: { name: string; tags: readonly string[] } | undefined;
        let current = state;
        let last: unknown;
        for (let round = 0; round < ROUNDS; round++) {
          current = plainUpdate(
            current,
            round % 10 === 0 ? { user: { name: `n${round}` } } : { session: { lastSeen: round } }
          ) as State;
          const name = current.user.name;
          const tags = current.user.tags;
          let same = previousName === name && previousTags !== undefined && previousTags.length === tags.length;
          if (same && previousTags !== tags) {
            for (let index = 0; index < tags.length; index++) {
              if (previousTags?.[index] !== tags[index]) {
                same = false;
                break;
              }
            }
          }
          if (!same || result === undefined) {
            previousName = name;
            previousTags = tags;
            result = { name, tags };
          }
          last = result;
        }
        return last;
      },
    },
  ],
});

await runSuite("derive");
