import { AOT } from "@jit/compiler";

export default AOT.defineConfig({
  entries: ["compiled/catalog.jit.ts"],
  patterns: ["**/*.jit.ts"],
  output: {
    mode: "directory",
    directory: "compiled/generated",
    importSpecifier: "#examples",
    packageName: "@jit/examples-generated",
    emitPackageJson: true,
    clean: true,
  },
  target: { runtime: "node", engine: "v8", version: "22", module: "esm" },
  compiler: {
    mode: "production",
    optimization: "aggressive",
    sourceMaps: false,
    declarations: true,
  },
  performance: {
    shapes: true,
    strings: true,
    allocation: "auto",
    strategies: "auto",
  },
  emit: {
    rootBarrel: true,
    subpathModules: true,
    manifest: true,
    plans: true,
    runtimeSchemas: false,
  },
  diagnostics: { explainPlans: true, generatedSource: true },
});
