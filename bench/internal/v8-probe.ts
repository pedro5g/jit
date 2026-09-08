import { JIT } from "@jit-compiler/jit";

const StringValue = JIT.ddd.valueObject(JIT.string());
const NumberValue = JIT.ddd.valueObject(JIT.number());
const stringLeft = StringValue.create("jit");
const stringRight = StringValue.create("jit");
const numberLeft = NumberValue.create(42);
const numberRight = NumberValue.create(42);

function monomorphic(): boolean {
  return stringLeft.equals(stringRight);
}

function polymorphic(index: number): boolean {
  return index % 2 === 0 ? stringLeft.equals(stringRight) : numberLeft.equals(numberRight);
}

let checksum = 0;
for (let index = 0; index < 500_000; index++) {
  if (monomorphic()) checksum++;
  if (polymorphic(index)) checksum++;
}

if (checksum !== 1_000_000) throw new Error(`unexpected V8 probe checksum: ${checksum}`);
