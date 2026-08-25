# Event Standard V1

## Protocol

A JIT domain-event instance exposes non-enumerable structural metadata at
`event["~event"]`:

```ts
interface StandardEvent {
  readonly version: 1;
  readonly type: string;
  readonly schemaVersion: number;
}
```

`version` identifies this protocol. `type` is the stable event name and
`schemaVersion` is the version supplied when the event class is defined.

The event value itself remains schema-first:

```ts
{
  id: string;
  type: string;
  version: number;
  occurredAt: Date;
  payload: unknown;
}
```

The payload is validated by the event schema. Consumers do not need to import
JIT to inspect the protocol metadata or consume the envelope.

## Publisher boundary

Applications provide publication infrastructure through this minimal contract:

```ts
interface EventPublisher<TEvent = unknown> {
  publish(event: TEvent): void | Promise<void>;
}
```

JIT intentionally provides no event bus. An aggregate owns a pending-event
journal and exposes `commit(publisher)`. It publishes events in insertion
order and clears the journal only after every publication succeeds. A failure
leaves the pending events intact for an explicit retry.

Events never publish themselves. Publication, acknowledgement and persistence
are application-infrastructure concerns, not facts of the domain event.

## AOT

AOT output emits the same `~event` metadata and aggregate journal as plain
JavaScript. It contains no JIT event or aggregate runtime dependency.
