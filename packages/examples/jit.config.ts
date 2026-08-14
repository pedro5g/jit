import { AOT } from "@jit-compiler/jit";

export default AOT.defineConfig({
  entries: ["compiled/catalog.jit.ts"],
  patterns: ["**/*.jit.ts"],
  output: {
    directory: "compiled/generated",
    clean: true,
    format: "typescript",
  },
  emit: {
    subpathModules: true,
    manifest: true,
    plans: true,
  },
});
