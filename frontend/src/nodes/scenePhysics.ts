import { scenePhysicsCatalog } from "./scenePhysicsCatalog";
import * as CANNON from "cannon-es";
import * as THREE from "three";
import type { GraphNode } from "../types";
import type { Vec3 } from "./geometry";
import { geometryMesh, v, xyz } from "./meshRuntime";
import { isSceneSpec, mergeScenes, type SceneSpec } from "./sceneRuntime";
export type BodySpec = {
  mass: number;
  shape: "box" | "sphere";
  restitution: number;
  friction: number;
  velocity: Vec3;
  angularVelocity: Vec3;
};
export type ForceSpec = {
  type: "directional" | "radial" | "vortex";
  strength: number;
  direction: Vec3;
  center: Vec3;
};
export type ConstraintSpec = {
  type: "distance" | "point" | "hinge";
  a: number;
  b: number;
  distance: number;
  pivotA: Vec3;
  pivotB: Vec3;
  axis: Vec3;
};
export type BoneSpec = {
  id: string;
  parent: string;
  start: Vec3;
  end: Vec3;
  rotation: Vec3;
};
const types = new Set(scenePhysicsCatalog.map((n) => n.type));
export function cookScenePhysicsNode(
  node: GraphNode,
  time: number,
  input: (key?: string) => unknown,
  state: Map<string, unknown>,
): SceneSpec | undefined {
  if (!types.has(node.type)) return;
  const value = input("in");
  if (value && !isSceneSpec(value)) throw new Error("物理组件需要场景输入");
  const scene = mergeScenes(value),
    p = node.data.params,
    n = (key: string, fallback = 0) => Number(p[key] ?? fallback),
    s = (key: string, fallback = "") => String(p[key] ?? fallback),
    vec = (prefix = "", fallback = 0): Vec3 => [
      n(prefix + "x", fallback),
      n(prefix + "y", fallback),
      n(prefix + "z", fallback),
    ];
  if (node.type === "actor_comp") {
    const index = n("index", -1);
    scene.objects = scene.objects.map((object, i) =>
      index < 0 || index === i
        ? {
            ...object,
            body: {
              mass: n("mass", 1),
              shape: s("shape", "box") as "box" | "sphere",
              restitution: n("restitution", 0.4),
              friction: n("friction", 0.3),
              velocity: vec("v"),
              angularVelocity: vec("w"),
            },
          }
        : object,
    );
  } else if (node.type === "force_comp")
    scene.forces = [
      ...(scene.forces ?? []),
      {
        type: s("type", "directional") as ForceSpec["type"],
        strength: n("strength", 1),
        direction: vec("d"),
        center: vec("center"),
      },
    ];
  else if (node.type === "constraint_comp")
    scene.constraints = [
      ...(scene.constraints ?? []),
      {
        type: s("type", "distance") as ConstraintSpec["type"],
        a: n("a"),
        b: n("b", 1),
        distance: n("distance", 2),
        pivotA: vec("pivotA"),
        pivotB: vec("pivotB"),
        axis: vec("axis"),
      },
    ];
  else if (node.type === "bone_comp") {
    const bone: BoneSpec = {
      id: s("name", "bone1"),
      parent: s("parent"),
      start: vec("start"),
      end: vec("end"),
      rotation: vec("r"),
    };
    if (scene.bones?.some((old) => old.id === bone.id))
      throw new Error("同一骨骼网络中名称不能重复");
    if (bone.parent && !scene.bones?.some((old) => old.id === bone.parent))
      throw new Error("父骨骼必须在上游存在");
    scene.bones = [...(scene.bones ?? []), bone];
    if (p.display !== false) {
      const end = v(bone.end)
        .sub(v(bone.start))
        .applyEuler(
          new THREE.Euler(
            ...(bone.rotation.map(THREE.MathUtils.degToRad) as Vec3),
          ),
        )
        .add(v(bone.start));
      scene.objects.push({
        geometry: {
          shape: "line",
          detail: 8,
          start: bone.start,
          end: xyz(end),
          width: 0.055,
        },
        material: {
          kind: "material",
          model: "constant",
          color: "#f9cf7d",
          opacity: 1,
        },
      });
    }
  } else if (node.type === "handle_comp") {
    const index = n("index");
    if (!scene.objects[index]) throw new Error("场景对象索引不存在");
    const object = scene.objects[index];
    object.position = xyz(v(object.position ?? [0, 0, 0]).add(v(vec("d"))));
    object.rotation = xyz(v(object.rotation ?? [0, 0, 0]).add(v(vec("r"))));
  } else {
    type Memory = {
      signature: string;
      time: number;
      world: CANNON.World;
      bodies: (CANNON.Body | undefined)[];
    };
    const signature = JSON.stringify([
      scene.objects.map((object) => [
        object.geometry,
        object.position,
        object.rotation,
        object.scale,
        object.body,
      ]),
      scene.constraints,
      p,
    ]);
    let memory = state.get(node.id) as Memory | undefined;
    if (!memory || memory.signature !== signature || time < memory.time) {
      const world = new CANNON.World({
          gravity: new CANNON.Vec3(0, n("gravity", -9.81), 0),
        }),
        bodies: (CANNON.Body | undefined)[] = [];
      world.allowSleep = true;
      world.broadphase = new CANNON.SAPBroadphase(world);
      if (p.ground !== false) {
        const ground = new CANNON.Body({
          mass: 0,
          shape: new CANNON.Plane(),
          material: new CANNON.Material({ friction: 0.4, restitution: 0.3 }),
        });
        ground.position.set(0, n("ground_y", -2), 0);
        ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
        world.addBody(ground);
      }
      for (const object of scene.objects) {
        if (!object.body) {
          bodies.push(undefined);
          continue;
        }
        const vertices = geometryMesh(object.geometry).positions.map(v),
          box = new THREE.Box3().setFromPoints(vertices),
          size = box
            .getSize(new THREE.Vector3())
            .multiply(v(object.scale ?? [1, 1, 1]))
            .multiplyScalar(0.5),
          center = box
            .getCenter(new THREE.Vector3())
            .multiply(v(object.scale ?? [1, 1, 1])),
          spec = object.body;
        const shape =
            spec.shape === "sphere"
              ? new CANNON.Sphere(
                  Math.max(
                    0.001,
                    Math.abs(size.x),
                    Math.abs(size.y),
                    Math.abs(size.z),
                  ),
                )
              : new CANNON.Box(
                  new CANNON.Vec3(
                    Math.max(0.001, Math.abs(size.x)),
                    Math.max(0.001, Math.abs(size.y)),
                    Math.max(0.001, Math.abs(size.z)),
                  ),
                ),
          body = new CANNON.Body({
            mass: spec.mass,
            material: new CANNON.Material({
              friction: spec.friction,
              restitution: spec.restitution,
            }),
          });
        body.addShape(shape, new CANNON.Vec3(center.x, center.y, center.z));
        body.position.set(...(object.position ?? [0, 0, 0]));
        body.quaternion.setFromEuler(
          ...((object.rotation ?? [0, 0, 0]).map(
            THREE.MathUtils.degToRad,
          ) as Vec3),
        );
        body.velocity.set(...spec.velocity);
        body.angularVelocity.set(...spec.angularVelocity);
        world.addBody(body);
        bodies.push(body);
      }
      for (const spec of scene.constraints ?? []) {
        const a = bodies[spec.a],
          b = bodies[spec.b];
        if (!a || !b) throw new Error("约束两端必须为已启用 Actor 的场景对象");
        const ca = new CANNON.Vec3(...spec.pivotA),
          cb = new CANNON.Vec3(...spec.pivotB),
          axis = new CANNON.Vec3(...spec.axis);
        if (spec.type === "distance")
          world.addConstraint(
            new CANNON.DistanceConstraint(a, b, spec.distance),
          );
        else if (spec.type === "point")
          world.addConstraint(new CANNON.PointToPointConstraint(a, ca, b, cb));
        else
          world.addConstraint(
            new CANNON.HingeConstraint(a, b, {
              pivotA: ca,
              pivotB: cb,
              axisA: axis,
              axisB: axis,
            }),
          );
      }
      memory = { signature, time, world, bodies };
      state.set(node.id, memory);
    }
    const dt = Math.min(0.1, Math.max(0, time - memory.time));
    if (!p.paused && dt > 0) {
      const steps = Math.min(
        Math.max(1, Math.floor(n("substeps", 8))),
        Math.max(1, Math.ceil(dt * 120)),
      );
      for (let step = 0; step < steps; step++) {
        for (const body of memory.bodies)
          if (body && body.mass > 0)
            for (const field of scene.forces ?? []) {
              const center = v(field.center),
                position = new THREE.Vector3(
                  body.position.x,
                  body.position.y,
                  body.position.z,
                ),
                force =
                  field.type === "directional"
                    ? v(field.direction)
                    : field.type === "radial"
                      ? center.sub(position)
                      : new THREE.Vector3(
                          -(position.z - center.z),
                          0,
                          position.x - center.x,
                        );
              force.normalize().multiplyScalar(field.strength);
              body.applyForce(new CANNON.Vec3(force.x, force.y, force.z));
            }
        memory.world.step(dt / steps);
      }
    }
    memory.time = time;
    scene.objects = scene.objects.map((object, i) => {
      const body = memory!.bodies[i];
      if (!body) return object;
      const euler = new THREE.Euler().setFromQuaternion(
        new THREE.Quaternion(
          body.quaternion.x,
          body.quaternion.y,
          body.quaternion.z,
          body.quaternion.w,
        ),
      );
      return {
        ...object,
        position: [body.position.x, body.position.y, body.position.z],
        rotation: [euler.x, euler.y, euler.z].map(
          THREE.MathUtils.radToDeg,
        ) as Vec3,
      };
    });
  }
  return scene;
}
