import { AOT } from "@jit-compiler/jit";

export default AOT.defineConfig({
  entries: ["compiled/catalog.jit.ts"],
  output: {
    directory: "compiled/generated",
    format: "ts",
  },
});
