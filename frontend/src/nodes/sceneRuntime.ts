import type {
  BodySpec,
  ForceSpec,
  ConstraintSpec,
  BoneSpec,
} from "./scenePhysics";
import * as THREE from "three";
import { buildGeometryObject, type GeometrySpec, type Vec3 } from "./geometry";
import type { MaterialSpec } from "./materialRuntime";
export type CameraSpec = {
  projection: "perspective" | "orthographic";
  position: Vec3;
  target: Vec3;
  fov: number;
  near: number;
  far: number;
  zoom: number;
};
export type LightSpec = {
  type: "ambient" | "directional" | "point" | "spot" | "hemisphere";
  color: string;
  intensity: number;
  position: Vec3;
  target?: Vec3;
  groundColor?: string;
  distance?: number;
  decay?: number;
  angle?: number;
};
export type SceneObjectSpec = {
  body?: BodySpec;
  geometry: GeometrySpec;
  material?: MaterialSpec;
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  visible?: boolean;
};
export type SceneSpec = {
  forces?: ForceSpec[];
  constraints?: ConstraintSpec[];
  bones?: BoneSpec[];
  kind: "scene";
  objects: SceneObjectSpec[];
  lights: LightSpec[];
  camera?: CameraSpec;
  background?: string;
};
export function isSceneSpec(value: unknown): value is SceneSpec {
  return (
    !!value &&
    typeof value === "object" &&
    "kind" in value &&
    value.kind === "scene"
  );
}
export function mergeScenes(...values: unknown[]): SceneSpec {
  const result: SceneSpec = { kind: "scene", objects: [], lights: [] };
  for (const value of values)
    if (isSceneSpec(value)) {
      result.objects.push(...value.objects.map((object) => ({ ...object })));
      result.lights.push(...value.lights.map((light) => ({ ...light })));
      if (value.camera) result.camera = value.camera;
      if (value.background) result.background = value.background;
      if (value.forces)
        result.forces = [...(result.forces ?? []), ...value.forces];
      if (value.constraints)
        result.constraints = [
          ...(result.constraints ?? []),
          ...value.constraints,
        ];
      if (value.bones) result.bones = [...(result.bones ?? []), ...value.bones];
    }
  return result;
}
export function disposeSceneObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  const visit = (object: THREE.Object3D) => {
    if (object.userData.tdBorrowedResources) return;
    if (
      object instanceof THREE.Mesh ||
      object instanceof THREE.Line ||
      object instanceof THREE.Points
    ) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material])
        materials.add(material);
    }
    object.children.forEach(visit);
  };
  visit(root);
  geometries.forEach((item) => item.dispose());
  materials.forEach((item) => item.dispose());
}
/** Fresh owned render scene, with an explicit camera and independently editable lights. */
export function buildScene(
  spec: SceneSpec,
  width: number,
  height: number,
  resolveModel?: (url: string) => THREE.Object3D | undefined,
): { scene: THREE.Scene; camera: THREE.Camera; dispose: () => void } {
  const scene = new THREE.Scene();
  try {
    if (spec.background) scene.background = new THREE.Color(spec.background);
    for (const [objectIndex, item] of spec.objects.entries()) {
      const withMaterial = (geometry: GeometrySpec): GeometrySpec =>
        item.material
          ? {
              ...geometry,
              material: item.material,
              children: geometry.children?.map(withMaterial),
            }
          : geometry;
      const object = buildGeometryObject(
        withMaterial(item.geometry),
        "#cccccc",
        false,
        resolveModel,
      );
      if (item.position) object.position.fromArray(item.position);
      if (item.rotation)
        object.rotation.set(
          ...(item.rotation.map(THREE.MathUtils.degToRad) as Vec3),
        );
      if (item.scale) object.scale.fromArray(item.scale);
      object.visible = item.visible !== false;
      object.userData.tdObjectIndex = objectIndex;
      scene.add(object);
    }
    for (const entry of spec.lights) {
      let light: THREE.Light;
      if (entry.type === "ambient")
        light = new THREE.AmbientLight(entry.color, entry.intensity);
      else if (entry.type === "hemisphere")
        light = new THREE.HemisphereLight(
          entry.color,
          entry.groundColor ?? "#252540",
          entry.intensity,
        );
      else if (entry.type === "point")
        light = new THREE.PointLight(
          entry.color,
          entry.intensity,
          entry.distance ?? 0,
          entry.decay ?? 2,
        );
      else if (entry.type === "spot")
        light = new THREE.SpotLight(
          entry.color,
          entry.intensity,
          entry.distance ?? 0,
          entry.angle ?? Math.PI / 4,
          0.2,
          entry.decay ?? 2,
        );
      else light = new THREE.DirectionalLight(entry.color, entry.intensity);
      light.position.fromArray(entry.position);
      if (
        (light instanceof THREE.DirectionalLight ||
          light instanceof THREE.SpotLight) &&
        entry.target
      ) {
        light.target.position.fromArray(entry.target);
        scene.add(light.target);
      }
      scene.add(light);
    }
    const c =
      spec.camera ??
      ({
        projection: "perspective",
        position: [4, 3, 6],
        target: [0, 0, 0],
        fov: 45,
        near: 0.01,
        far: 1000,
        zoom: 1,
      } satisfies CameraSpec);
    if (c.near <= 0 || c.far <= c.near)
      throw new Error("相机裁剪范围必须满足 0 < near < far");
    const aspect = Math.max(0.001, width / Math.max(1, height));
    const camera =
      c.projection === "orthographic"
        ? new THREE.OrthographicCamera(
            -3 * aspect,
            3 * aspect,
            3,
            -3,
            c.near,
            c.far,
          )
        : new THREE.PerspectiveCamera(c.fov, aspect, c.near, c.far);
    camera.position.fromArray(c.position);
    camera.lookAt(new THREE.Vector3(...c.target));
    camera.zoom = c.zoom;
    camera.updateProjectionMatrix();
    return { scene, camera, dispose: () => disposeSceneObject(scene) };
  } catch (error) {
    disposeSceneObject(scene);
    throw error;
  }
}
