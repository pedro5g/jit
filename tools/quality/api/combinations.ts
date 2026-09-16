import type { OperationCombination, OperationContract } from "./contracts.js";

const COMBINATION_POLICIES: Readonly<Record<string, readonly OperationCombination[]>> = {
  "builder.parse": [
    {
      operation: "builder.validate",
      expected: "valid",
      notes: "Parsing establishes the input boundary consumed by validation.",
    },
  ],
  "validation-check.min": [
    {
      operation: "validation-check.max",
      expected: "valid",
      notes: "Lower and upper bounds compose into one bounded validation stage.",
    },
  ],
  "validation-check.trim": [
    {
      operation: "validation-check.lowercase",
      expected: "valid",
      notes: "Normalization stages preserve declaration order and may accumulate.",
    },
  ],
  "class.extends": [
    {
      operation: "class.accessors",
      expected: "valid",
      notes: "A class extension may be followed by its accessor declarations.",
    },
  ],
  "cqrs.select": [
    {
      operation: "cqrs.where",
      expected: "valid",
      notes: "Projection and filtering are independent query stages.",
    },
  ],
  "factory.parse": [
    {
      operation: "factory.validate",
      expected: "valid",
      notes: "Factory parsing establishes the capability required by validation.",
    },
  ],
};

export function combinationFields(
  family: string,
  name: string
): Pick<OperationContract, "combinesWith"> | Record<never, never> {
  const combinations = COMBINATION_POLICIES[`${family}.${name}`];
  return combinations ? { combinesWith: combinations } : {};
}
