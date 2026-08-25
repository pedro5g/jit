# JIT Standards

JIT standards are small structural contracts designed for integration without a
dependency on JIT internals. They are versioned from their first release.

- [Event Standard V1](./event-v1.md) describes domain-event metadata and the
  publisher boundary.
- [Query Standard V1](./query-v1.md) describes portable read-query
  definitions without exposing the execution planner.

These contracts are not implementations of Standard Schema. They use the same
interoperability principle: consumers depend on a small public shape rather
than on a runtime class or internal compiler representation.
