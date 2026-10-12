import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Tests run in Node; browser-only modules are not imported by them.
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
