/**
 * Material id -> visual mapping (art direction over the sim's material
 * IDENTITIES; never game logic). Falls back by name heuristic so new sim
 * materials render sensibly without a renderer edit (Law: renderer must
 * not hard-depend on the sim's property set).
 */
export type MaterialVisualClass = "generic" | "soil" | "stone" | "wood" | "sand" | "clay" | "leaves";

export interface MaterialVisual {
  readonly classId: number; // 0 generic, 1 soil, 2 stone, 3 wood, 4 sand, 5 clay, 6 leaves
  readonly color: readonly [number, number, number];
}

const TABLE: Readonly<Record<string, MaterialVisual>> = {
  soil: { classId: 1, color: [0.37, 0.26, 0.16] },
  stone: { classId: 2, color: [0.44, 0.46, 0.5] },
  wood: { classId: 3, color: [0.34, 0.22, 0.11] },
  bark: { classId: 3, color: [0.32, 0.22, 0.12] },
  sand: { classId: 4, color: [0.72, 0.65, 0.48] },
  clay: { classId: 5, color: [0.55, 0.37, 0.27] },
  leaves: { classId: 6, color: [0.32, 0.5, 0.22] },
  "plant-matter": { classId: 6, color: [0.4, 0.52, 0.24] },
};

export function materialVisual(materialId: string): MaterialVisual {
  const known = TABLE[materialId];
  if (known !== undefined) return known;
  if (materialId.includes("soil") || materialId.includes("dirt") || materialId.includes("mud")) return TABLE["soil"]!;
  if (materialId.includes("stone") || materialId.includes("rock")) return TABLE["stone"]!;
  if (materialId.includes("wood") || materialId.includes("log") || materialId.includes("timber")) return TABLE["wood"]!;
  if (materialId.includes("sand")) return TABLE["sand"]!;
  if (materialId.includes("clay")) return TABLE["clay"]!;
  if (materialId.includes("leaf") || materialId.includes("plant") || materialId.includes("grass")) return TABLE["leaves"]!;
  return { classId: 0, color: [0.5, 0.44, 0.38] };
}
