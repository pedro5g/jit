# Workspace, CLI And Ghost

Continues [RECONSTRUCTIVE_ARTIFACTS_PLAN.md](RECONSTRUCTIVE_ARTIFACTS_PLAN.md).
That plan delivered the transport; this one delivers the surface a reader
actually touches: a multi-file workspace that declares a directory tree, a CLI
that reconstructs it without leaving state behind, and an assistant that only
speaks after it has checked itself.

## Objective

Nothing reaches a reader unverified. Every example the ghost writes runs before
it is shown, every generated tree is reconstructed byte-exactly by the CLI, and
every claim is checked against the compiled library rather than trusted.

## Status

1. Done — `c6d2f35`.
2. Done — `dd4a5e3`.
3. Done — `ab3398b`.
4. Partly done — `36bcb06` carries the guide options, the beta labelling and the
   bottom-sheet chat. Still open: the ghost typing into the workspace on its own,
   and the copy pass over the marketing pages (em dashes, assistant mannerisms,
   alignment).
5. Done — `36bcb06`.

## Phases

### 1 — The ghost stops being wrong in public

- No unaudited text ever paints on screen. The visible stream is replaced by
  the real stages: reading, writing, checking, running, correcting.
- Every jit code block the ghost writes is transpiled and executed against the
  real library before the answer is shown. A block that throws, loops or names
  a value it never declares is an audit finding, not an answer.
- An example is only an example when it is self-contained: a schema, a compiled
  operation, and data to run it with.
- When repair fails, the answer keeps the prose that passed and swaps the block
  for the nearest verified example, labelled as such.

### 2 — A workspace with directories

- The editor holds a project rather than a file: create, rename, move and delete
  files and directories, persisted locally.
- The entrypoint import (`@jit-compiler/jit/runtime`, `@jit-compiler/jit/define`)
  is owned by the workspace and cannot be edited away.
- Run shows input and output as data, not as a console dump.
- Generate compiles the declared tree, shows the output structure file by file,
  and hands over the CLI command that reconstructs it.

### 3 — A CLI that only reconstructs

- No state file. The journal, the transaction commands and `jit.artifact.json`
  are removed: what the CLI needs it takes as a flag or asks for on the
  terminal.
- Directories are first-class: the declared tree, including empty directories,
  survives the round trip, and reconstruction merges into an existing tree
  rather than replacing it wholesale.
- The registry origin is environment-controlled: `--registry`, `JIT_LAB_REGISTRY`
  and a named environment, with one documented precedence and a `doctor` that
  prints which one is in effect.

### 4 — The ghost guides (beta)

- "show me in the docs" and "take me there" close the panel, navigate, and point
  at the passage worth reading.
- In the workspace it types the schema and runs the generation, rather than
  printing something to copy.
- Every generative capability is labelled beta and says it can be wrong.

### 5 — Documentation

- The front-end model is documented as a context that has to be rebuilt when the
  API, the docs or the workspace change; `CLAUDE.md` and `AGENTS.md` say so.

## Non-goals

- A hosted account system for the workspace. Projects are local.
- Executing arbitrary reader code outside the sandboxed worker.
- A larger assistant model. The floor is verified retrieval; the model is an
  explanation layer on top of it.
