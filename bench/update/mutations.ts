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

  /**
   * The whole reason the channels exist.
   *
   * Asking for the new value, the change mask, the forward patch and the
   * inverse patch separately means three passes over the same fields. The
   * mutation already compared those fields to decide what to rebuild, so it
   * can answer all four from that one comparison.
   */
  const changed = JIT.compare.changed(DeepUserSchema);
  const onePass = JIT.state
    .update(DeepUserSchema)
    .patch({ profile: { name: JIT.cqrs.param("name"), address: { city: JIT.cqrs.param("city") } } })
    .result({ value: true, changed: true, patch: true, inverse: true })
    .compile();
  const diff = JIT.compare.diff(DeepUserSchema);

  registerScenario({
    op: "mutation channels",
    name: "value, mask, forward and inverse patch",
    args: [value, { name: "changed", city: "changed" }],
    jit: onePass as (...args: never[]) => unknown,
    competitors: [
      {
        name: "update + changed + diff + inverse diff",
        fn: (current: DeepUser) => {
          const next = genericUpdate(current, {
            profile: { name: "changed", address: { city: "changed" } },
          });
          return {
            value: next,
            changed: changed(current, next),
            patch: diff(current, next),
            inverse: diff(next, current),
          };
        },
      },
    ],
  });

  registerScenario({
    op: "mutation channels",
    name: "value and mask only",
    args: [value, { name: "changed", city: "changed" }],
    jit: JIT.state
      .update(DeepUserSchema)
      .patch({ profile: { name: JIT.cqrs.param("name"), address: { city: JIT.cqrs.param("city") } } })
      .result({ value: true, changed: true })
      .compile() as (...args: never[]) => unknown,
    competitors: [
      {
        name: "update + changed",
        fn: (current: DeepUser) => {
          const next = genericUpdate(current, {
            profile: { name: "changed", address: { city: "changed" } },
          });
          return { value: next, changed: changed(current, next) };
        },
      },
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
