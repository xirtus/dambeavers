import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // tests/gate/** are deliberately long-running soak tests (tens of
    // thousands of simulated ticks over a real composed colony loop) --
    // excluded from the default fast suite so `npm test` stays a quick
    // everyday feedback loop; run them explicitly with `npm run test:gate`.
    exclude: ["tests/gate/**", "**/node_modules/**"],
    environment: "node",
    reporters: "default",
  },
});
