import { JIT } from "@jit-compiler/jit";
import { produce } from "../shared/competitors.js";
import { createDeepUser, type DeepUser, DeepUserSchema } from "../shared/data.js";
import { registerScenario } from "../shared/scenario.js";

/**
 * A declared patch against the generic deep-partial update it replaces.
 *
 * The generic update accepts any patch, so it has to look at every field of
 * every level it is given. A declared patch is known before the call, so the
 * planner knows which levels can change and rebuilds only those.
 */
export function registerDeclaredMutations(): void {
  const value = createDeepUser();
  const genericUpdate = JIT.state.update(DeepUserSchema).compile();
  const declaredDeep = JIT.state
    .update(DeepUserSchema)
    .patch({ profile: { address: { zip: JIT.cqrs.param("zip") } } })
    .compile();
  const declaredSiblings = JIT.state
    .update(DeepUserSchema)
    .patch({ profile: { name: JIT.cqrs.param("name"), address: { city: JIT.cqrs.param("city") } } })
    .compile();

  registerScenario({
    op: "declared mutation",
    name: "deep nested scalar",
    args: [value, { zip: 99999 }],
    jit: declaredDeep as (...args: never[]) => unknown,
    competitors: [
      {
        name: "JIT generic update",
        fn: (current: DeepUser) => genericUpdate(current, { profile: { address: { zip: 99999 } } }),
      },
      {
        name: "immer",
        fn: (current: DeepUser) => produce(current, (draft) => void (draft.profile.address.zip = 99999)),
      },
      {
        name: "handwritten spread",
        fn: (current: DeepUser) =>
          current.profile.address.zip === 99999
            ? current
            : {
                ...current,
                profile: { ...current.profile, address: { ...current.profile.address, zip: 99999 } },
              },
      },
    ],
  });

  registerScenario({
    op: "declared mutation",
    name: "deep nested scalar, unchanged",
    args: [value, { zip: value.profile.address.zip }],
    jit: declaredDeep as (...args: never[]) => unknown,
    competitors: [
      {
        name: "JIT generic update",
        fn: (current: DeepUser) =>
          genericUpdate(current, { profile: { address: { zip: current.profile.address.zip } } }),
      },
      { name: "immer", fn: (current: DeepUser) => produce(current, () => {}) },
    ],
  });

  registerScenario({
    op: "declared mutation",
    name: "two branches, one shared parent",
    args: [value, { name: "changed", city: "changed" }],
    jit: declaredSiblings as (...args: never[]) => unknown,
    competitors: [
      {
        name: "JIT generic update",
        fn: (current: DeepUser) =>
          genericUpdate(current, { profile: { name: "changed", address: { city: "changed" } } }),
      },
      {
        name: "immer",
        fn: (current: DeepUser) =>
          produce(current, (draft) => {
            draft.profile.name = "changed";
            draft.profile.address.city = "changed";
          }),
      },
    ],
  });
}
