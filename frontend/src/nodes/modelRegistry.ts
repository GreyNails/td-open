import type * as THREE from "three";
/** Non-owning references let SOP topology conversion use the same decoded model as Render. */
const models = new Map<string, WeakRef<THREE.Object3D>>();
export function registerSceneModel(url: string, model: THREE.Object3D): void {
  models.set(url, new WeakRef(model));
  if (models.size > 128) models.delete(models.keys().next().value!);
}
export function forgetSceneModel(url: string): void {
  models.delete(url);
}
export function resolveSceneModel(url: string): THREE.Object3D | undefined {
  const model = models.get(url)?.deref();
  if (!model) models.delete(url);
  return model;
}
