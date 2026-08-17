import type { MaterialId } from "../materials/Material.js";
import type { Biome } from "./Biomes.js";

/**
 * P6-10: raw material availability derived from real biome/elevation
 * facts (P6-05's own `Biome` classification, already itself derived
 * from real climate/geography) -- never a per-region scripted deposit
 * list. `depositsAt` is a pure function over `(biome, elevationFraction)`
 * so the SAME biome always yields the SAME available deposits, and a
 * settlement's own economy is genuinely constrained by where it sits
 * (the literal "constrain settlement economies" acceptance clause).
 */
export function depositsAt(biome: Biome, elevationFraction: number): readonly MaterialId[] {
  if (biome === "mountain" || elevationFraction >= 0.6) return ["stone"];
  if (biome === "wetland") return ["clay"];
  if (biome === "forest") return ["wood"];
  if (biome === "desert") return ["sand"];
  if (biome === "tundra") return ["stone"];
  return [];
}
