/**
 * Materials define properties, not behavior. Every function in this file
 * that derives a behavior (does it float, how much does it obstruct flow,
 * how costly is it to walk across) takes a `MaterialProperties` value and
 * computes a result from a formula over its fields -- never a switch/if on
 * a material's id or displayName. See ARCHITECTURE_CONTRACT §7: prefer
 * `density < fluidDensity` over `if material == WOOD`. That is what makes
 * "changing a material definition alters behavior without changing code"
 * (this feature's acceptance test) actually true rather than aspirational.
 *
 * Units/scale: `density` and `thermalConductivity` are given plausible
 * real-world-scale values (kg/m^3, and a W/(m*K)-like relative scale
 * respectively) since future systems will want realistic mass (density *
 * volume, for P0-10 tree/log mass) and comparative heat behavior.
 * `hardness`/`strength`/`buoyancy` are unitless positive game-scale
 * coefficients with no fixed upper bound (there's no reason stone
 * couldn't be defined harder than today's baseline later). `friction`/
 * `permeability`/`decayResistance` are bounded [0,1] fractions with a
 * natural physical meaning (permeability: fraction of flow passed;
 * decayResistance: 1 = never decays). None of these claim laboratory
 * precision -- they are tunable balance data, per
 * DAMN_BEAVERS_MASTER_ROADMAP.md §E (Mod/data architecture).
 *
 * `MaterialProperties` deliberately has no `id`/`displayName` field --
 * only `MaterialDefinition` (below) adds those. Every behavior function in
 * this file is typed to take `MaterialProperties`, not
 * `MaterialDefinition`, so branching on a material's identity (comparing
 * its id string against a known material name) is a TypeScript compile
 * error inside them, not just a convention nobody happens to have
 * violated yet. That's a stronger
 * guarantee than the "no branching" acceptance test's source-text scan can
 * offer on its own -- see that test's doc comment for exactly what the
 * scan does and doesn't prove (in particular: it cannot catch
 * value-based special-casing, e.g. `if (material.density === 600)`, which
 * is the same scripted-outcome smell wearing a different disguise; that
 * remains a code-review concern, not something this file's types can rule
 * out).
 */
export interface MaterialProperties {
  /** kg/m^3. Must be > 0 (air is a real material with real, if low, density -- there is no "weightless" material). */
  density: number;
  /** Unitless resistance-to-abrasion coefficient, >= 0, no fixed upper bound. */
  hardness: number;
  /** Unitless resistance-to-structural-failure coefficient, >= 0, no fixed upper bound. */
  strength: number;
  /** Surface friction coefficient, [0, 1]. 0 = frictionless, 1 = maximally resistant to sliding. */
  friction: number;
  /** Fraction of flow/liquid that can pass through a unit cross-section, [0, 1]. 0 = impermeable, 1 = freely permeable. */
  permeability: number;
  /** Buoyancy coefficient beyond what raw density-vs-fluid-density already implies, >= 0. 1 = no correction (plain Archimedes via density); reserved for future porous/hollow-structure refinements. */
  buoyancy: number;
  /** Relative thermal conductivity, >= 0, roughly W/(m*K) scale (e.g. water ~0.6, stone ~2, air ~0.025) but not claimed to be laboratory-exact. */
  thermalConductivity: number;
  /** Biological/organic origin -- affects future decay, combustion, and food-value systems. */
  organic: boolean;
  /** Resistance to decay over time, [0, 1]. 1 = never decays, 0 = decays instantly. */
  decayResistance: number;
}

export type MaterialId = string;

export interface MaterialDefinition extends MaterialProperties {
  readonly id: MaterialId;
  readonly displayName: string;
}

export interface MaterialRegistryDebugState {
  materialCount: number;
  ids: string[];
}

const MATERIAL_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

function assertValidProperties(def: MaterialDefinition): void {
  if (!MATERIAL_ID_PATTERN.test(def.id)) {
    throw new RangeError(
      `material id must be non-empty lowercase kebab-case (e.g. "wood", "plant-matter"), got ${JSON.stringify(def.id)}`,
    );
  }
  if (def.displayName.length === 0) {
    throw new RangeError(`material "${def.id}" must have a non-empty displayName`);
  }
  const checks: Array<[keyof MaterialProperties, boolean]> = [
    ["density", def.density > 0 && Number.isFinite(def.density)],
    ["hardness", def.hardness >= 0 && Number.isFinite(def.hardness)],
    ["strength", def.strength >= 0 && Number.isFinite(def.strength)],
    ["friction", def.friction >= 0 && def.friction <= 1],
    ["permeability", def.permeability >= 0 && def.permeability <= 1],
    ["buoyancy", def.buoyancy >= 0 && Number.isFinite(def.buoyancy)],
    ["thermalConductivity", def.thermalConductivity >= 0 && Number.isFinite(def.thermalConductivity)],
    ["decayResistance", def.decayResistance >= 0 && def.decayResistance <= 1],
  ];
  for (const [field, valid] of checks) {
    if (!valid) {
      throw new RangeError(`material "${def.id}": invalid ${field} value ${JSON.stringify(def[field])}`);
    }
  }
}

/**
 * A named database of material definitions. Unlike `ComponentType`
 * (Core/ComponentStore.ts), where two same-named tokens are deliberately
 * allowed to coexist because component identity is by object reference,
 * materials ARE referenced by their string id from other data (a log's
 * "made of wood" reference is a name, not an object) -- so a duplicate id
 * here is unambiguously a bug (accidental re-registration), not a
 * legitimate use case, and `define()` rejects it loudly.
 *
 * Persistence: this registry has no toSnapshot/fromSnapshot. Materials are
 * code-defined data (see standardMaterials.ts), not created/destroyed
 * during play -- a save references materials purely by stable string id,
 * and a fresh registry is rebuilt via `registerStandardMaterials()` (or
 * equivalent) on load, so there is no live registry state to serialize.
 * The intended reload pattern is therefore "construct a new
 * MaterialRegistry per load," not "reuse one across loads" (which would
 * hit `define()`'s duplicate-id rejection).
 */
export class MaterialRegistry {
  private readonly materials = new Map<MaterialId, MaterialDefinition>();

  define(definition: MaterialDefinition): void {
    assertValidProperties(definition);
    if (this.materials.has(definition.id)) {
      throw new RangeError(`material "${definition.id}" is already defined`);
    }
    this.materials.set(definition.id, Object.freeze({ ...definition }));
  }

  get(id: MaterialId): MaterialDefinition {
    const def = this.materials.get(id);
    if (def === undefined) {
      throw new RangeError(`unknown material id "${id}"`);
    }
    return def;
  }

  has(id: MaterialId): boolean {
    return this.materials.has(id);
  }

  all(): MaterialDefinition[] {
    return [...this.materials.values()];
  }

  getDebugState(): MaterialRegistryDebugState {
    return { materialCount: this.materials.size, ids: [...this.materials.keys()].sort() };
  }
}

// --- Generic derived behavior: formulas over properties, never over identity. ---

/**
 * Whether an object made of `material` floats in a fluid of the given
 * density (Archimedes' principle applied to bulk material density; does
 * not account for hollow/porous geometry -- a future system with real
 * volume/shape could refine this using `buoyancy` as a correction term).
 */
export function floatsIn(material: MaterialProperties, fluidDensityKgPerM3: number): boolean {
  return material.density < fluidDensityKgPerM3;
}

/** Fraction of flow obstructed by this material filling a cross-section, [0,1]. The complement of permeability -- 0 = no obstruction, 1 = fully blocking. */
export function hydraulicResistance(material: MaterialProperties): number {
  return 1 - material.permeability;
}

/** Multiplier applied to a base movement cost when traversing a surface made of this material. 1 = no penalty, higher = more resistant. */
export function movementCostMultiplier(material: MaterialProperties): number {
  return 1 + material.friction;
}

/**
 * Mass in kg of a volume of this material. Pins the unit convention
 * (volume in m^3) once, here, so P0-10 (tree/log mass) and P1-09 (hauling
 * cost) don't each independently guess -- and potentially disagree on --
 * whether volume means m^3, cell-units, or cm^3.
 */
export function massOf(material: MaterialProperties, volumeM3: number): number {
  return material.density * volumeM3;
}
