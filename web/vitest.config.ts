import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    reporters: ["default"],
    // Hide warnings about jsx in app/ since we only test lib/
    typecheck: { enabled: false },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
