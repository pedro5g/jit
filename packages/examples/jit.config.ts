import { AOT } from "@jit-compiler/jit";

export default AOT.defineConfig({
  entries: ["compiled/catalog.jit.ts"],
  patterns: ["**/*.jit.ts"],
  output: {
    directory: "compiled/generated",
    clean: true,
  },
  emit: {
    subpathModules: true,
    manifest: true,
    plans: true,
  },
  types: { package: "@jit-compiler/jit" },
});
