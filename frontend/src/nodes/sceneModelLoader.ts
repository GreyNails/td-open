import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
/** Caller owns the loaded asset and is responsible for geometry/material/texture disposal. */
export async function loadSceneModel(url: string): Promise<THREE.Group> {
  const path = new URL(url, "http://localhost").pathname.toLowerCase();
  if (path.endsWith(".fbx")) return new FBXLoader().loadAsync(url);
  if (path.endsWith(".obj")) return new OBJLoader().loadAsync(url);
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.animations = gltf.animations;
  return gltf.scene;
}
