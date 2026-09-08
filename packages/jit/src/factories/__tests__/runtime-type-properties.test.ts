import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { JIT } from "../../index.js";

describe("Runtime Type semantic properties", () => {
  it("keeps scalar Value Object equality symmetric and hash-consistent", () => {
    const Text = JIT.ddd.valueObject(JIT.string());

    fc.assert(
      fc.property(fc.string(), fc.string(), (leftInput, rightInput) => {
        const left = Text.create(leftInput);
        const right = Text.create(rightInput);
        const expected = leftInput === rightInput;

        expect(left.equals(right)).toBe(expected);
        expect(right.equals(left)).toBe(expected);
        if (expected) expect(left.hashCode()).toBe(right.hashCode());
      })
    );
  });

  it("keeps materialized nested Runtime Types equal to their boundary values", () => {
    const Identifier = JIT.ddd.uniqueIdentifier(JIT.string());
    const Money = JIT.ddd.valueObject(JIT.object({ amount: JIT.number(), currency: JIT.string() }));
    const Order = JIT.ddd.entity(JIT.object({ id: Identifier, total: Money, tags: JIT.array(JIT.string()) }), {
      id: "id",
    });
    const boundary = fc.record({
      id: fc.string(),
      total: fc.record({ amount: fc.double({ noNaN: true, noDefaultInfinity: true }), currency: fc.string() }),
      tags: fc.array(fc.string(), { maxLength: 8 }),
    });

    fc.assert(
      fc.property(boundary, (input) => {
        const created = Order.create(input);
        expect(created.id.value).toBe(input.id);
        expect(created.total.amount).toBe(input.total.amount);
        expect(created.tags).toEqual(input.tags);
        expect(created.equals(created)).toBe(true);
      })
    );
  });

  it("keeps cloned mutable Runtime Type instances independent while preserving equality", () => {
    const User = JIT.ddd
      .entity(JIT.object({ id: JIT.string(), name: JIT.string(), tags: JIT.array(JIT.string()) }), { id: "id" })
      .extends(JIT.class.clone());

    fc.assert(
      fc.property(
        fc.record({ id: fc.string(), name: fc.string(), tags: fc.array(fc.string(), { maxLength: 8 }) }),
        (input) => {
          const original = User.create(input);
          const clone = original.clone();

          expect(clone).not.toBe(original);
          expect(clone.equals(original)).toBe(true);
          expect(clone.tags).not.toBe(original.tags);
        }
      )
    );
  });
});
