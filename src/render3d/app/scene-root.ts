/** Scene roots (threejs_layer.md §7.1): stable hierarchy every subsystem hangs off. */
import { Group, Scene, FogExp2, Color } from "three/webgpu";

export interface SceneRoots {
  readonly scene: Scene;
  readonly worldRoot: Group;
  readonly terrainRoot: Group;
  readonly waterRoot: Group;
  readonly vegetationRoot: Group;
  readonly structuresRoot: Group;
  readonly entityRoot: Group;
  readonly effectsRoot: Group;
  readonly overlayRoot: Group;
  readonly debugRoot: Group;
}

export function createSceneRoots(): SceneRoots {
  const scene = new Scene();
  scene.fog = new FogExp2(new Color(0.55, 0.62, 0.7), 0.0038);
  const worldRoot = new Group();
  const terrainRoot = new Group();
  const waterRoot = new Group();
  const vegetationRoot = new Group();
  const structuresRoot = new Group();
  const entityRoot = new Group();
  const effectsRoot = new Group();
  const overlayRoot = new Group();
  const debugRoot = new Group();
  worldRoot.add(terrainRoot, waterRoot, vegetationRoot, structuresRoot, entityRoot, effectsRoot);
  scene.add(worldRoot, overlayRoot, debugRoot);
  return { scene, worldRoot, terrainRoot, waterRoot, vegetationRoot, structuresRoot, entityRoot, effectsRoot, overlayRoot, debugRoot };
}
