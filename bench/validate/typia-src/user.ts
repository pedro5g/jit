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

export interface TypiaSimple {
  id: number & tags.Type<"int32">;
  name: string;
}

export type TypiaUsers = TypiaUser[];

export const isSimple = typia.createIs<TypiaSimple>();
export const assertSimple = typia.createAssert<TypiaSimple>();
export const validateSimple = typia.createValidate<TypiaSimple>();
export const assertParseSimple = typia.json.createAssertParse<TypiaSimple>();
export const validateParseSimple = typia.json.createValidateParse<TypiaSimple>();
export const isUser = typia.createIs<TypiaUser>();
export const assertUser = typia.createAssert<TypiaUser>();
export const validateUser = typia.createValidate<TypiaUser>();
export const isUsers = typia.createIs<TypiaUsers>();
export const assertUsers = typia.createAssert<TypiaUsers>();
export const validateUsers = typia.createValidate<TypiaUsers>();
export const assertParseUser = typia.json.createAssertParse<TypiaUser>();
export const validateParseUser = typia.json.createValidateParse<TypiaUser>();
export const assertParseUsers = typia.json.createAssertParse<TypiaUsers>();
export const validateParseUsers = typia.json.createValidateParse<TypiaUsers>();
