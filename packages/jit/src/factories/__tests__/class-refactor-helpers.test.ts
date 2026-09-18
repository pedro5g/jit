import { describe, expect, it } from "vitest";
import { resolveFactoryOption } from "../../classes/factory-option.js";
import { JIT } from "../../index.js";
import { classMixin } from "../class-core-mixin.js";
import { getRuntimeClassTarget } from "../class-core-runtime.js";

describe("Runtime Class factory and mixin boundaries", () => {
  it("normalizes factory names and rejects descriptors for the wrong phase", () => {
    const implementation = () => undefined;
    const create = JIT.class.factory("make", implementation);
    const hydrate = JIT.class.factory("restore", implementation, "hydrate");
    const field = JIT.class.public(JIT.string());

    expect(resolveFactoryOption(undefined, "create", "create")).toEqual({ name: "create" });
    expect(resolveFactoryOption(false, "create", "create")).toEqual({ name: false });
    expect(resolveFactoryOption("make", "create", "create")).toEqual({ name: "make" });
    expect(resolveFactoryOption(create, "create", "create")).toEqual({ name: "make", implementation });
    expect(resolveFactoryOption(hydrate, "hydrate", "hydrate")).toEqual({ name: "restore", implementation });

    expect(() => resolveFactoryOption(hydrate, "create", "create")).toThrow(/cannot configure create/i);
    expect(() => resolveFactoryOption(field as never, "create", "create")).toThrow(/invalid class factory/i);
    expect(() => resolveFactoryOption({} as never, "create", "create")).toThrow(/invalid class factory/i);
  });

  it("freezes mixins and keeps their declaration markers out of enumeration", () => {
    const requires = { id: JIT.string() };
    const mixin = classMixin({
      requires,
      fields: { label: JIT.string() },
      methods: {
        describe() {
          return this.label;
        },
      },
    });
    const materialized = mixin();
    const marker = Object.getOwnPropertyDescriptor(mixin, "__classMixin");
    const requirements = Object.getOwnPropertyDescriptor(mixin, "__requires");

    expect(Object.isFrozen(mixin)).toBe(true);
    expect(materialized.label).toBeDefined();
    expect(materialized.describe).toBeTypeOf("function");
    expect(Object.keys(materialized)).toEqual(["label", "describe"]);
    expect(marker).toMatchObject({ enumerable: false, value: true, writable: false });
    expect(requirements).toMatchObject({ enumerable: false, value: requires, writable: false });

    expect(() =>
      classMixin({
        fields: { duplicate: JIT.string() },
        methods: {
          duplicate() {
            return "duplicate";
          },
        },
      })
    ).toThrow(/same member/i);
  });
});

describe("Runtime Class capabilities", () => {
  it("keeps JSON capabilities valid, reconstructive, and configurable on prototypes", () => {
    const capability = JIT.class.json({ method: "serialize" });
    const defaultCapability = JIT.class.json();
    const User = JIT.class(JIT.object({ name: JIT.string() })).extends(capability);
    const DefaultUser = JIT.class(JIT.object({ name: JIT.string() })).extends(defaultCapability);
    const user = new User({ name: "Ada" });
    const defaultUser = new DefaultUser({ name: "Ada" });

    expect(capability).toMatchObject({ kind: "class.json", __memberNames: ["serialize"] });
    expect(defaultCapability).toMatchObject({ kind: "class.json", __memberNames: ["toJson"] });
    expect(user.serialize()).toBe('{"name":"Ada"}');
    expect(defaultUser.toJson()).toBe('{"name":"Ada"}');
    expect(Object.getOwnPropertyDescriptor(User.prototype, "serialize")).toMatchObject({
      configurable: true,
      enumerable: false,
      writable: false,
    });
    expect(() => JIT.class.json({ method: "not-valid" })).toThrow(/invalid class JSON method/i);
  });

  it("installs built-in capabilities as configurable, non-enumerable prototype methods", () => {
    const User = JIT.class(JIT.object({ name: JIT.string() })).extends(
      JIT.class.equals(),
      JIT.class.hashCode(),
      JIT.class.clone(),
      JIT.class.diff(),
      JIT.class.with()
    );
    const descriptors = ["equals", "hashCode", "clone", "diff", "with"].map((name) =>
      Object.getOwnPropertyDescriptor(User.prototype, name)
    );

    expect(descriptors).toHaveLength(5);
    for (const descriptor of descriptors) {
      expect(descriptor).toMatchObject({ configurable: true, enumerable: false, writable: false });
    }
    const user = new User({ name: "Ada" });
    expect(user.clone()).not.toBe(user);
    expect(user.with({ name: "Grace" }).name).toBe("Grace");
    expect(user.diff(user)).toEqual([]);
  });
});

describe("Runtime Class targets and boundaries", () => {
  it("protects abstract construction and recognizes only marked class targets", () => {
    const Abstract = JIT.class.abstract(JIT.object({ name: JIT.string() }));
    const Concrete = JIT.class(JIT.object({ name: JIT.string() }));

    expect(() => (Abstract as unknown as { construction(mode: string): unknown }).construction("constructor")).toThrow(
      /abstract Runtime Class/i
    );
    expect(getRuntimeClassTarget(Concrete)).toBe(Concrete);
    expect(getRuntimeClassTarget(() => undefined)).toBeUndefined();
    expect(getRuntimeClassTarget({})).toBeUndefined();
  });

  it("keeps object Value Objects frozen and allows an explicit scalar boundary change", () => {
    const Box = JIT.ddd.valueObject(JIT.object({ value: JIT.string() }));
    const Scalar = JIT.ddd.valueObject(JIT.string()).construction("constructor");
    const box = Box.create({ value: "Ada" });

    expect(Object.isFrozen(box)).toBe(true);
    expect(new Scalar("Ada").value).toBe("Ada");
    expect("create" in Scalar).toBe(false);
    expect("hydrate" in Scalar).toBe(false);
  });
});

describe("Runtime Class validation boundaries", () => {
  it("requires defaults for no-constructor fields and preserves custom factory validation", () => {
    expect(() =>
      JIT.class(JIT.object({ id: JIT.string() })).extends({
        cache: JIT.class.noConstructor(JIT.string()),
      })
    ).toThrow(/requires a default initializer/i);

    const User = JIT.ddd
      .entity(JIT.object({ id: JIT.string(), age: JIT.number() }), { id: "id" })
      .factories({
        create: JIT.class.factory("make", (data: { id: string; age: number }, context) => context.construct(data)),
        hydrate: JIT.class.factory(
          "restore",
          (data: { id: string; age: number }, context) => context.construct(data),
          "hydrate"
        ),
      })
      .validate();

    expect(() => User.make({ id: "u_1", age: "bad" as never })).toThrow();
    expect(() => User.restore({ id: "u_1", age: "bad" as never })).toThrow();
    expect(User.make({ id: "u_1", age: 1 }).age).toBe(1);
    expect(User.restore({ id: "u_1", age: 2 }).age).toBe(2);
  });
});
