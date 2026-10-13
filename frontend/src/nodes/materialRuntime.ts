import * as THREE from "three";

export type MaterialSpec = {
  kind: "material";
  model:
    | "constant"
    | "depth"
    | "glsl"
    | "line"
    | "pbr"
    | "phong"
    | "points"
    | "wireframe";
  color: string;
  opacity: number;
  doubleSide?: boolean;
  roughness?: number;
  metalness?: number;
  clearcoat?: number;
  transmission?: number;
  ior?: number;
  emissive?: string;
  emissiveIntensity?: number;
  shininess?: number;
  size?: number;
  depthTest?: boolean;
  vertexShader?: string;
  fragmentShader?: string;
  time?: number;
  map?: HTMLCanvasElement;
  normalMap?: HTMLCanvasElement;
};
export function isMaterialSpec(value: unknown): value is MaterialSpec {
  return (
    !!value &&
    typeof value === "object" &&
    "kind" in value &&
    value.kind === "material"
  );
}
/** Each material owns its canvas textures. Dispose releases only those textures. */
export function buildMaterial(spec: MaterialSpec): THREE.Material {
  const owned: THREE.Texture[] = [];
  const texture = (canvas?: HTMLCanvasElement, color = true) => {
    if (!canvas) return null;
    const result = new THREE.CanvasTexture(canvas);
    result.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    owned.push(result);
    return result;
  };
  const common = {
    color: spec.color,
    opacity: spec.opacity,
    transparent: spec.opacity < 1,
    side: spec.doubleSide === false ? THREE.FrontSide : THREE.DoubleSide,
    depthTest: spec.depthTest !== false,
  };
  const map = texture(spec.map);
  let material: THREE.Material;
  switch (spec.model) {
    case "pbr":
      material = new THREE.MeshPhysicalMaterial({
        ...common,
        map,
        normalMap: texture(spec.normalMap, false),
        roughness: spec.roughness ?? 0.4,
        metalness: spec.metalness ?? 0.2,
        clearcoat: spec.clearcoat ?? 0,
        transmission: spec.transmission ?? 0,
        ior: spec.ior ?? 1.5,
        emissive: spec.emissive ?? "#000000",
        emissiveIntensity: spec.emissiveIntensity ?? 1,
      });
      break;
    case "phong":
      material = new THREE.MeshPhongMaterial({
        ...common,
        map,
        normalMap: texture(spec.normalMap, false),
        shininess: spec.shininess ?? 40,
        emissive: spec.emissive ?? "#000000",
      });
      break;
    case "depth":
      material = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        side: common.side,
        opacity: common.opacity,
        transparent: common.transparent,
      });
      break;
    case "line":
      material = new THREE.LineBasicMaterial(common);
      break;
    case "points":
      material = new THREE.PointsMaterial({
        ...common,
        map,
        size: spec.size ?? 0.05,
        sizeAttenuation: true,
      });
      break;
    case "wireframe":
      material = new THREE.MeshBasicMaterial({ ...common, wireframe: true });
      break;
    case "glsl":
      material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: spec.time ?? 0 },
          uColor: { value: new THREE.Color(spec.color) },
          uOpacity: { value: spec.opacity },
          uTexture: { value: map },
        },
        vertexShader: spec.vertexShader,
        fragmentShader: spec.fragmentShader,
        side: common.side,
        transparent: common.transparent,
        opacity: common.opacity,
      });
      break;
    default:
      material = new THREE.MeshBasicMaterial({ ...common, map });
  }
  material.addEventListener("dispose", () => owned.forEach((t) => t.dispose()));
  return material;
}
