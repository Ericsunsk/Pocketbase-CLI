import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin.ts"],
  platform: "node",
  target: "node20",
  format: ["cjs"],
  sourcemap: true,
  clean: true
});
