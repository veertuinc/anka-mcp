import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // E2E tests spawn a server on a fixed port; keep files from racing on ports.
    fileParallelism: false,
    // Keep the in-process config singleton deterministic and avoid spawning the
    // real anka binary during unit tests.
    env: {
      ANKA_LOCAL: "off"
    }
  }
});
