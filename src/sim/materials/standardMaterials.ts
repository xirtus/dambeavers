import type { MaterialDefinition, MaterialRegistry } from "./Material.js";

/**
 * The initial material set named in the roadmap (P0-07). Values are
 * plausible, game-balance-scale approximations of real substances (see
 * Material.ts's file doc comment for what each field's scale means) --
 * tunable data, not a claim of scientific precision. `buoyancy` is left
 * at 1 (no correction beyond raw density) for every entry here; a future
 * material needing a porous/hollow correction can set it directly without
 * this file changing shape.
 *
 * Versioning/determinism: editing a value here (a balance patch) is an
 * intentional data change that alters the interpretation of every
 * existing save's material references and every replay's material-derived
 * results, by design -- this table has no per-entity identity to preserve,
 * unlike EntityIdRegistry/WorldGrid state. `STANDARD_MATERIALS_VERSION`
 * exists so a future save/replay system that needs exact historical
 * reproduction across such patches has something to pin and compare
 * against, without this file needing to build that system itself now.
 */
export const STANDARD_MATERIALS_VERSION = 1;
export const STANDARD_MATERIALS: readonly MaterialDefinition[] = [
  {
    id: "water",
    displayName: "Water",
    density: 1000,
    hardness: 0,
    strength: 0,
    friction: 0.05,
    permeability: 1,
    buoyancy: 1,
    thermalConductivity: 0.6,
    organic: false,
    decayResistance: 1,
  },
  {
    id: "ice",
    displayName: "Ice",
    density: 917, // less dense than liquid water -- ice floats, real physics
    hardness: 1.5,
    strength: 1,
    friction: 0.1, // notoriously slippery
    permeability: 0.02, // near-impermeable -- P4-12's own "blocks flow" requirement
    buoyancy: 1,
    thermalConductivity: 2.2,
    organic: false,
    decayResistance: 1,
  },
  {
    id: "air",
    displayName: "Air",
    density: 1.2,
    hardness: 0,
    strength: 0,
    friction: 0,
    permeability: 1,
    buoyancy: 1,
    thermalConductivity: 0.025,
    organic: false,
    decayResistance: 1,
  },
  {
    id: "soil",
    displayName: "Soil",
    density: 1300,
    hardness: 1,
    strength: 1,
    friction: 0.5,
    permeability: 0.4,
    buoyancy: 1,
    thermalConductivity: 0.8,
    organic: false,
    decayResistance: 0.9,
  },
  {
    id: "clay",
    displayName: "Clay",
    density: 1600,
    hardness: 1.5,
    strength: 1.5,
    friction: 0.4,
    permeability: 0.1, // notoriously watertight -- a strong dam-core material
    buoyancy: 1,
    thermalConductivity: 1.0,
    organic: false,
    decayResistance: 0.95,
  },
  {
    id: "sand",
    displayName: "Sand",
    density: 1600,
    hardness: 0.8,
    strength: 0.5,
    friction: 0.6,
    permeability: 0.7, // drains freely
    buoyancy: 1,
    thermalConductivity: 0.3,
    organic: false,
    decayResistance: 1,
  },
  {
    id: "stone",
    displayName: "Stone",
    density: 2700,
    hardness: 5,
    strength: 6,
    friction: 0.8,
    permeability: 0.05,
    buoyancy: 1,
    thermalConductivity: 2.0,
    organic: false,
    decayResistance: 1,
  },
  {
    id: "wood",
    displayName: "Wood",
    density: 600, // less dense than water -- logs float
    hardness: 2,
    strength: 3,
    friction: 0.5,
    permeability: 0.15,
    buoyancy: 1,
    thermalConductivity: 0.15,
    organic: true,
    decayResistance: 0.5,
  },
  {
    id: "bark",
    displayName: "Bark",
    density: 400,
    hardness: 1.2,
    strength: 1,
    friction: 0.6,
    permeability: 0.2,
    buoyancy: 1,
    thermalConductivity: 0.1,
    organic: true,
    decayResistance: 0.4,
  },
  {
    id: "leaves",
    displayName: "Leaves",
    density: 200,
    hardness: 0.1,
    strength: 0.1,
    friction: 0.3,
    permeability: 0.5,
    buoyancy: 1,
    thermalConductivity: 0.05,
    organic: true,
    decayResistance: 0.1, // decomposes quickly
  },
  {
    id: "plant-matter",
    displayName: "Plant Matter",
    density: 300,
    hardness: 0.3,
    strength: 0.3,
    friction: 0.4,
    permeability: 0.5,
    buoyancy: 1,
    thermalConductivity: 0.08,
    organic: true,
    decayResistance: 0.15,
  },
];

export function registerStandardMaterials(registry: MaterialRegistry): void {
  for (const material of STANDARD_MATERIALS) {
    registry.define(material);
  }
}
