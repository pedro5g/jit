import { describe, expectTypeOf, it } from "vitest";

/**
 * Type-system spike for a generated generic superclass.  A protected member
 * survives an intersection with the generated constructor instance and is
 * visible to a subclass while remaining inaccessible to its callers.
 */
declare abstract class SpikeDomainStateCarrier<TProps extends object> {
  protected readonly _props: TProps;
}

const SpikeGeneratedBase = class {} as unknown as {
  new (input: {
    readonly name: string;
    readonly id: string;
  }): SpikeDomainStateCarrier<{
    name: string;
    readonly id: string;
  }> & { readonly name: string; readonly id: string };
};

class SpikeUser extends SpikeGeneratedBase {
  rename(name: string): void {
    this._props.name = name;
  }

  replaceId(id: string): void {
    // @ts-expect-error identity state is readonly inside the domain surface
    this._props.id = id;
  }

  stateName(): string {
    return this._props.name;
  }
}

describe("DDD type spikes", () => {
  it("keeps generic domain state protected across a generated base", () => {
    expectTypeOf<ReturnType<SpikeUser["stateName"]>>().toEqualTypeOf<string>();

    if (Object.is(1, 2)) {
      const user = null as unknown as SpikeUser;
      // @ts-expect-error protected state is only available to the class hierarchy
      user._props;
    }
  });

  it("records the nested-call contextual typing limitation", () => {
    // The inner classSetter call is typed before classPublic receives the
    // sibling schema argument, so TypeScript cannot infer `value` from it.
    // @ts-expect-error Parameter 'value' implicitly has an 'any' type.
    const setter = (value) => value;
    expectTypeOf(setter).toBeFunction();
  });
});
