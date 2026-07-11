# Serialization And Binary Codec

JIT has two serialization paths:

- JSON stringify/parse generated from schemas;
- binary codec v2 for compact wire transport.

They solve different problems. JSON is for interoperable text. Binary codec is
for high-throughput internal transport where both sides share the schema.

## JSON Stringify

```ts
const User = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
  active: JIT.boolean(),
});

const stringifyUser = JIT.json(User).stringify().compile();

stringifyUser({ id: 1, name: "Ada", active: true });
```

In AOT declarations:

```ts
export const stringifyUser = JIT.json(User).stringify().compile();
```

Generated output imports as:

```ts
import { stringifyUser } from "@jit/generated";
```

## JSON Parse With Validation

```ts
const parseUserJson = JIT.json(User).parse().compile();

const user = parseUserJson('{"id":1,"name":"Ada","active":true}');
```

This parses JSON and validates the resulting value. It is useful at external
boundaries where JSON input must become trusted domain data.

## Binary Codec

```ts
const Event = JIT.object({
  id: JIT.number().int32(),
  kind: JIT.literal("click"),
  at: JIT.date(),
  target: JIT.string(),
});

const codec = JIT.codec(Event, { version: 2 });

const bytes = codec.encode(event);
const size = codec.encodeInto(event, scratch);
const decoded = codec.decode(bytes);
```

`encodeInto` is the lowest-allocation path when the caller owns a reusable
buffer.

## Why JSON Stringify Is Faster

Schema-driven stringify knows the field order and field types:

- no runtime property enumeration for known object shapes;
- no generic replacer path;
- direct string writes for primitives;
- nested serializers are specialized by schema.

For stable DTOs, this can beat generic `JSON.stringify` or external generic
serializers because the emitted function does not discover shape at runtime.

## Why Binary Codec Is Faster

The binary codec uses a fixed wire layout:

- version byte first;
- optional fields encoded as compact bitmasks;
- integers guarded and written directly;
- strings length-prefixed as UTF-8;
- `TextEncoder.encodeInto` writes into the final buffer;
- decode follows the same schema order.

There is no JSON parser, no string quoting, and no object-key scanning in the
wire representation.

## Why It Uses Less Memory

JSON stringify avoids intermediate projection objects when paired with query
selection. Binary codec can allocate a single exact `ArrayBuffer` after a
sizing pass, or write into caller-provided memory with `encodeInto`.

For repeated socket or worker messages, `encodeInto` plus a scratch buffer is
the preferred low-GC path.

## AOT And Tree Sharing

If a front-end route imports only a JSON stringifier, it should not ship the
binary codec. If it imports only a validator, it should not ship stringify.
AOT emits each function independently, and bundlers can drop unused exports.

Grouped objects should be used only when those operations naturally ship
together:

```ts
export const User = JIT.compile(UserSchema, {
  is: JIT.validate(UserSchema).is().compile(),
  stringify: JIT.json(UserSchema).stringify().compile(),
});
```

## Best Practices

- Use generated JSON stringify for stable public DTOs.
- Use generated JSON parse for external JSON boundaries.
- Use binary codec for internal high-throughput channels.
- Prefer `encodeInto` when you can reuse buffers.
- Keep binary codec versions explicit; changing layout is a wire-format
  breaking change.
