import { JIT } from "../../packages/jit/src/index.js";

const Fields10 = {
  field0: JIT.number(),
  field1: JIT.number(),
  field2: JIT.number(),
  field3: JIT.number(),
  field4: JIT.number(),
  field5: JIT.number(),
  field6: JIT.number(),
  field7: JIT.number(),
  field8: JIT.number(),
  field9: JIT.number(),
};

const Fields25 = {
  ...Fields10,
  field10: JIT.string(),
  field11: JIT.string(),
  field12: JIT.string(),
  field13: JIT.string(),
  field14: JIT.string(),
  field15: JIT.string(),
  field16: JIT.string(),
  field17: JIT.string(),
  field18: JIT.string(),
  field19: JIT.string(),
  field20: JIT.string(),
  field21: JIT.string(),
  field22: JIT.string(),
  field23: JIT.string(),
  field24: JIT.string(),
};

const Fields50 = {
  ...Fields25,
  field25: JIT.boolean(),
  field26: JIT.boolean(),
  field27: JIT.boolean(),
  field28: JIT.boolean(),
  field29: JIT.boolean(),
  field30: JIT.boolean(),
  field31: JIT.boolean(),
  field32: JIT.boolean(),
  field33: JIT.boolean(),
  field34: JIT.boolean(),
  field35: JIT.boolean(),
  field36: JIT.boolean(),
  field37: JIT.boolean(),
  field38: JIT.boolean(),
  field39: JIT.boolean(),
  field40: JIT.boolean(),
  field41: JIT.boolean(),
  field42: JIT.boolean(),
  field43: JIT.boolean(),
  field44: JIT.boolean(),
  field45: JIT.boolean(),
  field46: JIT.boolean(),
  field47: JIT.boolean(),
  field48: JIT.boolean(),
  field49: JIT.boolean(),
};

const Fields100 = {
  ...Fields50,
  field50: JIT.date(),
  field51: JIT.date(),
  field52: JIT.date(),
  field53: JIT.date(),
  field54: JIT.date(),
  field55: JIT.date(),
  field56: JIT.date(),
  field57: JIT.date(),
  field58: JIT.date(),
  field59: JIT.date(),
  field60: JIT.date(),
  field61: JIT.date(),
  field62: JIT.date(),
  field63: JIT.date(),
  field64: JIT.date(),
  field65: JIT.date(),
  field66: JIT.date(),
  field67: JIT.date(),
  field68: JIT.date(),
  field69: JIT.date(),
  field70: JIT.date(),
  field71: JIT.date(),
  field72: JIT.date(),
  field73: JIT.date(),
  field74: JIT.date(),
  field75: JIT.date(),
  field76: JIT.date(),
  field77: JIT.date(),
  field78: JIT.date(),
  field79: JIT.date(),
  field80: JIT.date(),
  field81: JIT.date(),
  field82: JIT.date(),
  field83: JIT.date(),
  field84: JIT.date(),
  field85: JIT.date(),
  field86: JIT.date(),
  field87: JIT.date(),
  field88: JIT.date(),
  field89: JIT.date(),
  field90: JIT.date(),
  field91: JIT.date(),
  field92: JIT.date(),
  field93: JIT.date(),
  field94: JIT.date(),
  field95: JIT.date(),
  field96: JIT.date(),
  field97: JIT.date(),
  field98: JIT.date(),
  field99: JIT.date(),
};

export const Schema10 = JIT.object(Fields10);
export const Schema25 = JIT.object(Fields25);
export const Schema50 = JIT.object(Fields50);
export const Schema100 = JIT.object(Fields100);

const Depth1 = JIT.object({ value: JIT.number() });
const Depth2 = JIT.object({ value: JIT.number(), child: Depth1 });
const Depth3 = JIT.object({ value: JIT.number(), child: Depth2 });
const Depth4 = JIT.object({ value: JIT.number(), child: Depth3 });
const Depth5 = JIT.object({ value: JIT.number(), child: Depth4 });
const Depth6 = JIT.object({ value: JIT.number(), child: Depth5 });
const Depth7 = JIT.object({ value: JIT.number(), child: Depth6 });
const Depth8 = JIT.object({ value: JIT.number(), child: Depth7 });
const Depth9 = JIT.object({ value: JIT.number(), child: Depth8 });
const Depth10 = JIT.object({ value: JIT.number(), child: Depth9 });

export const DepthSchemas = [Depth1, Depth3, Depth5, Depth10] as const;

export const LargeUnion = JIT.union(
  JIT.object({ kind: JIT.literal("zero"), value: JIT.number() }),
  JIT.object({ kind: JIT.literal("one"), value: JIT.string() }),
  JIT.object({ kind: JIT.literal("two"), value: JIT.boolean() }),
  JIT.object({ kind: JIT.literal("three"), value: JIT.date() }),
  JIT.object({ kind: JIT.literal("four"), value: JIT.array(JIT.number()) }),
  JIT.object({ kind: JIT.literal("five"), value: JIT.set(JIT.string()) }),
  JIT.object({ kind: JIT.literal("six"), value: JIT.mapSchema(JIT.string(), JIT.number()) }),
  JIT.object({ kind: JIT.literal("seven"), value: JIT.record(JIT.string(), JIT.boolean()) }),
  JIT.object({ kind: JIT.literal("eight"), value: JIT.tuple(JIT.string(), JIT.number()) }),
  JIT.object({ kind: JIT.literal("nine"), value: JIT.nullish(JIT.string()) })
);

export const CollectionSchema = JIT.object({
  array: JIT.array(Schema25),
  set: JIT.set(Schema10),
  map: JIT.mapSchema(JIT.string(), Schema10),
  record: JIT.record(JIT.string(), Schema10),
  tuple: JIT.tuple(Schema10, Schema25),
});

export const RuntimeTypeSchema = JIT.object({
  nested: JIT.ddd.valueObject(JIT.object({ value: JIT.string() })),
  optional: JIT.string().optional(),
});
