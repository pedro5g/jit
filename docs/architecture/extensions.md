# Extension boundary

Extensions are immutable environment capabilities. Each plugin has a stable
`id`, `version`, and ABI, and contributes to an `ExtensionSet` digest.

The supported progression is:

1. composition operators, which express a plugin in terms of built-in schema
   operations;
2. semantic operators, described by a restricted extension IR contract;
3. strategy candidates for an existing physical family.

The current kernel materializes composition operators. Semantic and strategy
descriptors are validated, digested, and kept behind the catalog boundary;
operation-specific lowering is enabled family by family after its runtime/AOT
contract and evidence exist. This prevents an extension API from promising a
generic lowering path before the compiler can preserve its semantics.

The extension IR contains semantic nodes such as load, compare, branch, loop,
intrinsic call, issue emission, transform, and return. It does not contain a
source writer, raw JavaScript, or emitter bindings. The compiler remains the
owner of determinism, runtime/AOT parity, target selection, and security.

The default AOT invariant is that generated artifacts do not import the plugin
after lowering. A plugin that needs a runtime binding must declare that
portable dependency and otherwise receives an explicit unsupported-extension
diagnostic.

Plugins also declare API grammar (`repeat`, `requires`, `provides`, `conflicts`,
`terminal`, and `fusion`) so fluent composition remains testable and typed.
