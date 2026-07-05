import { JIT } from "jit";
import { registerScenario } from "../shared/scenario.js";

const Event = JIT.object({
  id: JIT.number().int().positive(),
  name: JIT.string().min(2),
  value: JIT.number(),
});

const Events = JIT.array(Event);

interface BenchEvent {
  readonly id: number;
  readonly name: string;
  readonly value: number;
}

function makeEvents(count: number, badIndex: number): string {
  const items = Array.from({ length: count }, (_, index) => ({
    id: index === badIndex ? -1 : index + 1,
    name: `event-${index}`,
    value: index * 1.5,
  }));

  return JSON.stringify(items);
}

const validPayload = makeEvents(10_000, -1);
const earlyBadPayload = makeEvents(10_000, 3);

const validator = JIT.validator(Event);

/** The status quo: buffer everything, parse everything, then validate. */
function bufferParseValidate(payload: string): boolean {
  const parsed = JSON.parse(payload) as BenchEvent[];

  for (let index = 0; index < parsed.length; index++) {
    if (!validator.is(parsed[index])) return false;
  }
  return true;
}

function streamAll(payload: string): number {
  const stream = JIT.stream(Events);

  stream.write(payload);
  return stream.end().length;
}

function streamReject(payload: string): boolean {
  const stream = JIT.stream(Events);

  try {
    stream.write(payload);
    stream.end();
    return true;
  } catch {
    return false;
  }
}

export function registerStreamScenarios(): void {
  registerScenario({
    op: "stream validate",
    name: "reject bad item at index 3 of 10k",
    args: [earlyBadPayload],
    jit: streamReject,
    competitors: [
      {
        name: "JSON.parse + validate all",
        fn: (payload: string) => {
          try {
            return bufferParseValidate(payload);
          } catch {
            return false;
          }
        },
      },
    ],
  });

  registerScenario({
    op: "stream validate",
    name: "valid 10k items end-to-end",
    args: [validPayload],
    jit: streamAll,
    competitors: [
      {
        name: "JSON.parse + validate all",
        fn: (payload: string) => {
          if (!bufferParseValidate(payload)) throw new Error("unexpected invalid payload");
          return true;
        },
      },
      {
        name: "JSON.parse only",
        fn: (payload: string) => (JSON.parse(payload) as unknown[]).length,
        biased: "no validation at all — lower bound of any approach",
      },
    ],
  });
}
