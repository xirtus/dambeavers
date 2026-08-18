/**
 * Cell-to-world mapping (R1-02). The sim is integer cells, Y-up, one cell
 * = one world unit (ARCHITECTURE_CONTRACT §3). Render space is identical
 * except continuous: cell (x,y,z) OCCUPIES the unit cube [x,x+1)x[y,y+1)x[z,z+1),
 * so its center is (x+0.5, y+0.5, z+0.5). No axis remap anywhere.
 */
export function cellCenter(x: number, y: number, z: number): [number, number, number] {
  return [x + 0.5, y + 0.5, z + 0.5];
}

/** The unit cube's minimum corner (meshing works in corner space). */
export function cellOrigin(x: number, y: number, z: number): [number, number, number] {
  return [x, y, z];
}
