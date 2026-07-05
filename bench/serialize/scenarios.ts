import { JIT } from "jit";
import { registerScenario } from "../shared/scenario.js";

const UserSchema = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
  active: JIT.boolean(),
  tags: JIT.array(JIT.string()),
  profile: JIT.object({ age: JIT.number(), score: JIT.number(), city: JIT.string() }),
});

interface BenchUser {
  readonly id: number;
  readonly name: string;
  readonly active: boolean;
  readonly tags: readonly string[];
  readonly profile: { readonly age: number; readonly score: number; readonly city: string };
}

const user: BenchUser = {
  id: 42,
  name: "Ada Lovelace",
  active: true,
  tags: ["math", "pioneer"],
  profile: { age: 36, score: 99.5, city: "London" },
};

const EventSchema = JIT.object({
  id: JIT.number(),
  target: JIT.string(),
  at: JIT.date(),
  exact: JIT.boolean(),
  batch: JIT.array(JIT.object({ x: JIT.number(), y: JIT.number() })),
});

const event = {
  id: 7,
  target: "button-main",
  at: new Date("2026-07-05T12:00:00.000Z"),
  exact: true,
  batch: Array.from({ length: 50 }, (_, index) => ({ x: index * 1.5, y: index * 2.5 })),
};

export function registerSerializeScenarios(): void {
  const stringify = JIT.serializer(UserSchema).stringify;

  registerScenario({
    op: "serialize stringify",
    name: "medium user",
    args: [user],
    jit: stringify,
    competitors: [{ name: "native JSON.stringify", fn: (value: BenchUser) => JSON.stringify(value) }],
  });

  const codec = JIT.codec(EventSchema);
  const encodedEvent = codec.encode(event);
  const eventJson = JSON.stringify(event);

  registerScenario({
    op: "codec encode",
    name: "event batch 50",
    args: [event],
    jit: codec.encode,
    competitors: [{ name: "JSON.stringify", fn: (value: typeof event) => JSON.stringify(value) }],
  });

  registerScenario({
    op: "codec decode",
    name: "event batch 50",
    args: [encodedEvent],
    jit: codec.decode,
    competitors: [
      {
        name: "JSON.parse + new Date",
        fn: (_bytes: Uint8Array) => {
          const parsed = JSON.parse(eventJson) as typeof event & { at: string };

          return { ...parsed, at: new Date(parsed.at) };
        },
        biased: "parses an equivalent JSON string, not the binary input",
      },
    ],
  });
}
