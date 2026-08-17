import { defineConfig } from "vitest/config";

/** Runs ONLY the long-horizon gate soak tests the default `vitest.config.ts` deliberately excludes -- `npm run test:gate`. The full simulated-year soak genuinely takes ~25 wall-clock minutes (per-tick cost grows with the ever-accumulating job history, a known CPU characteristic of `JobBoard.currentJobOf`'s documented O(live-jobs) scan), so the timeout is a generous 40 minutes, not the fast suite's default. */
export default defineConfig({
  test: {
    include: ["tests/gate/**/*.test.ts"],
    environment: "node",
    reporters: "default",
    testTimeout: 2_400_000,
  },
});
