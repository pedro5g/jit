# Extension boundary

Extensions are immutable environment capabilities. Each plugin has a stable
`id`, `version`, and ABI, and contributes to an `ExtensionSet` digest.

The supported progression is:

1. composition operators, which express a plugin in terms of built-in schema
   operations;
2. semantic operators, described by a restricted extension IR contract;
3. strategy candidates for an existing physical family.

Composition operators build on existing schema operations. Semantic
extensions now lower a validated boolean predicate through the shared core IR
and validator emitter for runtime and AOT. The extension receives a filtered
schema view, normalized semantic facts, and only metadata keys listed in its
`metadataDependencies`. The extension identifier and normalized IR digest are
recorded in the physical plan and manifest; descriptive metadata is excluded.

Strategy extension descriptors are validated and versioned, including
legality, target support, integer estimates, evidence references and IR
lowering. They do not receive a source writer. The initial integration does not
let third-party candidates replace built-in emitter lowerings yet: a family
must first define the extension IR result contract and runtime/AOT conformance
for that operation. Unsupported IR effects and control-flow nodes fail before
emission instead of being silently ignored.

The versioned extension IR contract contains load, literal, compare, logical,
branch, loop, intrinsic call, issue emission, transform, and return nodes. The
current generic lowerer accepts expression programs for boolean predicates;
issue emission and general control-flow lowering require an operation-specific
contract. The IR does not contain raw JavaScript, source templates, writer
methods, emitter bindings, or runtime callbacks. The compiler remains the owner
of normalization, determinism, runtime/AOT parity, target selection, and
security.

The default AOT invariant is that generated artifacts do not import the plugin
after lowering. A plugin that needs a runtime binding must declare that
portable dependency and otherwise receives an explicit unsupported-extension
diagnostic.

Plugins also declare API grammar (`repeat`, `requires`, `provides`, `conflicts`,
`terminal`, and `fusion`) so fluent composition remains testable and typed.
