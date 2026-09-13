import { bench, do_not_optimize, group, run } from "mitata";

type State = Record<string, number | string | boolean>;

const STATE = Symbol("domain-state");

class DirectState {
  protected readonly _props: State;

  constructor(state: State) {
    this._props = state;
  }

  get field0(): number | string | boolean {
    return this._props.field0;
  }

  readDomainState(): number | string | boolean {
    return this._props.field0;
  }

  readTenFields(): number {
    return (
      (this._props.field0 as number) +
      (this._props.field1 as number) +
      (this._props.field2 as number) +
      (this._props.field3 as number) +
      (this._props.field4 as number) +
      (this._props.field5 as number) +
      (this._props.field6 as number) +
      (this._props.field7 as number) +
      (this._props.field8 as number) +
      (this._props.field9 as number)
    );
  }

  writeDomainState(value: number): void {
    this._props.field0 = value;
  }

  writeTenFields(value: number): void {
    for (let index = 0; index < 10; index++) this._props[`field${index}`] = value;
  }

  clone(): DirectState {
    return new DirectState({ ...this._props });
  }

  equals(other: DirectState): boolean {
    return this._props.field0 === other._props.field0 && this._props.field9 === other._props.field9;
  }

  hashCode(): string {
    return `${this._props.field0}:${this._props.field9}`;
  }

  diff(other: DirectState): boolean {
    return this._props.field0 !== other._props.field0 || this._props.field9 !== other._props.field9;
  }

  toJson(): string {
    return JSON.stringify(this._props);
  }
}

class SymbolState {
  private declare [STATE]: State;

  constructor(state: State) {
    this[STATE] = state;
  }

  protected get _props(): State {
    return this[STATE];
  }

  get field0(): number | string | boolean {
    return this[STATE].field0;
  }

  readDomainState(): number | string | boolean {
    return this._props.field0;
  }

  readTenFields(): number {
    const state = this[STATE];
    return (
      (state.field0 as number) +
      (state.field1 as number) +
      (state.field2 as number) +
      (state.field3 as number) +
      (state.field4 as number) +
      (state.field5 as number) +
      (state.field6 as number) +
      (state.field7 as number) +
      (state.field8 as number) +
      (state.field9 as number)
    );
  }

  writeDomainState(value: number): void {
    this._props.field0 = value;
  }

  writeTenFields(value: number): void {
    const state = this[STATE];
    for (let index = 0; index < 10; index++) state[`field${index}`] = value;
  }

  clone(): SymbolState {
    return new SymbolState({ ...this[STATE] });
  }

  equals(other: SymbolState): boolean {
    const left = this[STATE];
    const right = other[STATE];
    return left.field0 === right.field0 && left.field9 === right.field9;
  }

  hashCode(): string {
    const state = this[STATE];
    return `${state.field0}:${state.field9}`;
  }

  diff(other: SymbolState): boolean {
    const left = this[STATE];
    const right = other[STATE];
    return left.field0 !== right.field0 || left.field9 !== right.field9;
  }

  toJson(): string {
    return JSON.stringify(this[STATE]);
  }
}

function createState(fieldCount: number): State {
  const state: State = {};
  for (let index = 0; index < fieldCount; index++) state[`field${index}`] = index;
  return state;
}

const state = createState(100);
const direct = new DirectState(state);
const symbol = new SymbolState(state);
const directOther = new DirectState({ ...state, field9: -1 });
const symbolOther = new SymbolState({ ...state, field9: -1 });

for (const fieldCount of [3, 10, 25, 50, 100]) {
  const input = createState(fieldCount);
  group(`${fieldCount} fields`, () => {
    bench("strategy A / direct state bag / construct", () => do_not_optimize(new DirectState({ ...input })));
    bench("strategy B / symbol slot / construct", () => do_not_optimize(new SymbolState({ ...input })));
    bench("strategy A / direct state bag / domain read", () => do_not_optimize(direct.readDomainState()));
    bench("strategy B / symbol slot / domain read", () => do_not_optimize(symbol.readDomainState()));
    bench("strategy A / direct state bag / public getter", () => do_not_optimize(direct.field0));
    bench("strategy B / symbol slot / public getter", () => do_not_optimize(symbol.field0));
    bench("strategy A / direct state bag / domain write", () => do_not_optimize(direct.writeDomainState(1)));
    bench("strategy B / symbol slot / domain write", () => do_not_optimize(symbol.writeDomainState(1)));
    bench("strategy A / direct state bag / ten reads", () => do_not_optimize(direct.readTenFields()));
    bench("strategy B / symbol slot / ten reads", () => do_not_optimize(symbol.readTenFields()));
    bench("strategy A / direct state bag / ten writes", () => do_not_optimize(direct.writeTenFields(1)));
    bench("strategy B / symbol slot / ten writes", () => do_not_optimize(symbol.writeTenFields(1)));
  });
}

group("semantic operations / 100 fields", () => {
  bench("strategy A / equals", () => do_not_optimize(direct.equals(directOther)));
  bench("strategy B / equals", () => do_not_optimize(symbol.equals(symbolOther)));
  bench("strategy A / hashCode", () => do_not_optimize(direct.hashCode()));
  bench("strategy B / hashCode", () => do_not_optimize(symbol.hashCode()));
  bench("strategy A / clone", () => do_not_optimize(direct.clone()));
  bench("strategy B / clone", () => do_not_optimize(symbol.clone()));
  bench("strategy A / diff", () => do_not_optimize(direct.diff(directOther)));
  bench("strategy B / diff", () => do_not_optimize(symbol.diff(symbolOther)));
  bench("strategy A / toJson", () => do_not_optimize(direct.toJson()));
  bench("strategy B / toJson", () => do_not_optimize(symbol.toJson()));
});

console.log(`strategy A source bytes: ${Buffer.byteLength(DirectState.toString())}`);
console.log(`strategy B source bytes: ${Buffer.byteLength(SymbolState.toString())}`);
await run();
