/**
 * The shared VISUAL clock (not the sim clock): drives water ripple scroll,
 * wind sway, particle life. Pinned to a fixed value in deterministic mode
 * (Law R11). Purely presentational (Law R4) -- never read by simulation.
 */
import { uniform } from "three/tsl";

export function createVisualClock() {
  return uniform(0);
}

export type VisualClock = ReturnType<typeof createVisualClock>;
