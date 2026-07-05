import typia, { type tags } from "typia";

/**
 * Mirror of the JIT bench UserSchema with typia tags — same constraints,
 * so the `typia generate` output is a fair AOT-vs-AOT comparison.
 */
export interface TypiaUser {
  id: number & tags.Type<"int32"> & tags.ExclusiveMinimum<0>;
  name: string & tags.MinLength<2> & tags.MaxLength<64>;
  email: string & tags.Format<"email">;
  active: boolean;
  tags: string[] & tags.MaxItems<8>;
  profile: {
    age: number & tags.Type<"int32"> & tags.Minimum<0> & tags.Maximum<150>;
    score: number;
  };
}

export const isUser = typia.createIs<TypiaUser>();
export const validateUser = typia.createValidate<TypiaUser>();
