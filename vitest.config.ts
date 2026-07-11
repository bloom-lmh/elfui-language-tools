import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

import { elfuiDevAliases } from "../../scripts/elfui-dev-alias";

export default defineConfig({
  define: {
    __DEV__: "true"
  },
  resolve: {
    alias: elfuiDevAliases
  },
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"]
  }
});
