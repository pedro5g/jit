import { JIT } from "@jit/compiler";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";

const COUNT = 1_000_000;
const Event = JIT.object({ id: JIT.number().int32(), active: JIT.boolean(), score: JIT.number().float32() });
const Events = JIT.array(Event);
type Event = JIT.infer<typeof Event>;

const events = createEvents(COUNT);
const lazyFirstTen = JIT.query(Events)
  .filter((q) => q.and(q.eq("active", true), q.gt("score", 900)))
  .select("id", "score")
  .take(10)
  .compileIterator();
const eagerFirstTen = JIT.query(Events)
  .filter((q) => q.and(q.eq("active", true), q.gt("score", 900)))
  .select("id", "score")
  .take(10)
  .compile();
const visitAll = JIT.query(Events)
  .filter((q) => q.eq("active", true))
  .select("id")
  .compileVisitor();
const lazyAll = JIT.query(Events)
  .filter((q) => q.eq("active", true))
  .select("id")
  .compileIterator();

registerScenario({
  op: "lazy early termination",
  name: `${COUNT} events / first 10 matches`,
  args: [events],
  jit: (input) => consume(lazyFirstTen(input)),
  competitors: [
    { name: "JIT eager specialized array", fn: eagerFirstTen },
    { name: "native generator", fn: (input) => consume(nativeFirstTen(input)) },
    { name: "native eager loop", fn: nativeEagerFirstTen },
  ],
});

registerScenario({
  op: "lazy full consumption",
  name: `${COUNT} events / 800k matches`,
  args: [events],
  jit: (input) => consume(lazyAll(input)),
  competitors: [
    { name: "JIT visitor", fn: (input) => visitAll(input, consumeValue) },
    { name: "native generator", fn: (input) => consume(nativeAll(input)) },
  ],
});

function createEvents(count: number): Event[] {
  const output = new Array<Event>(count);
  for (let index = 0; index < count; index++) {
    output[index] = { id: index, active: index % 5 !== 0, score: index % 1000 };
  }
  return output;
}

function consume<T>(iterable: Iterable<T>): number {
  let count = 0;
  for (const value of iterable) {
    consumeValue(value);
    count++;
  }
  return count;
}

function consumeValue(value: unknown): void {
  void value;
}

function* nativeFirstTen(input: readonly Event[]): IterableIterator<{ id: number; score: number }> {
  let count = 0;
  for (let index = 0; index < input.length; index++) {
    const item = input[index];
    if (!item.active || item.score <= 900) continue;
    yield { id: item.id, score: item.score };
    if (++count === 10) return;
  }
}

function nativeEagerFirstTen(input: readonly Event[]): { id: number; score: number }[] {
  const output = new Array<{ id: number; score: number }>(10);
  let count = 0;
  for (let index = 0; index < input.length; index++) {
    const item = input[index];
    if (!item.active || item.score <= 900) continue;
    output[count++] = { id: item.id, score: item.score };
    if (count === 10) break;
  }
  output.length = count;
  return output;
}

function* nativeAll(input: readonly Event[]): IterableIterator<{ id: number }> {
  for (let index = 0; index < input.length; index++) {
    const item = input[index];
    if (item.active) yield { id: item.id };
  }
}

await runSuite("lazy");
