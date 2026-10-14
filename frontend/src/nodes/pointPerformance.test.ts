import { describe, it, expect } from "vitest";
import {
  sampleSurface,
  cookEnvelope,
  displacedPoint,
  pointCloudPLY,
  type Dance,
} from "./pointPerformance";
import { makeChannels } from "../runtimeValues";
import { trackURL, performanceAncestors } from "./stemPerformance";
import type { GraphNode, Project } from "../types";
const node: GraphNode = {
  id: "envelope",
  type: "audio_envelope_chop",
  position: { x: 0, y: 0 },
  data: { label: "energy", params: { gain: 1, attack: 0.02, release: 0.4 } },
};
const value = (output: ReturnType<typeof cookEnvelope>, name: string) =>
  output.channels.find((ch) => ch.name === name)!.samples[0];
describe("Real mesh surface sampling", () => {
  it("weights unequal triangles by area, samples only their surfaces and is reproducible", () => {
    const geometry = {
      shape: "mesh",
      detail: 1,
      mesh: {
        positions: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
          [3, 0, 0],
          [5, 0, 0],
          [3, 2, 0],
        ] as [number, number, number][],
        faces: [
          [0, 1, 2],
          [3, 4, 5],
        ],
      },
    };
    const cloud = sampleSurface(geometry, 6000, 41, 1);
    expect(cloud.mesh!.positions).toHaveLength(6000);
    expect(cloud.mesh!.positions.every((p) => p[2] === 0)).toBe(true);
    const proportion =
      cloud.mesh!.positions.filter((p) => p[0] > 0).length / 6000;
    expect(proportion).toBeGreaterThan(0.77);
    expect(proportion).toBeLessThan(0.83);
    expect(cloud.mesh).toEqual(sampleSurface(geometry, 6000, 41, 1).mesh);
    expect(pointCloudPLY(cloud)).toContain("element vertex 6000");
  });
  it("rejects an unavailable model or geometry with no surface instead of generating a substitute", () => {
    expect(() =>
      sampleSurface(
        { shape: "model", detail: 1, url: "/api/assets/missing.glb" },
        1000,
        1,
        1,
      ),
    ).toThrow(/模型/);
    expect(() =>
      sampleSurface(
        {
          shape: "mesh",
          detail: 1,
          mesh: { positions: [[0, 0, 0]], faces: [] },
        },
        1000,
        1,
        1,
      ),
    ).toThrow(/三角/);
  });
});
describe("Independent real stereo envelopes", () => {
  it("uses both channels without cancelling opposite phase and leaves silence at zero", () => {
    const pcm = makeChannels(
      { left: Array(2048).fill(0.09), right: Array(2048).fill(-0.09) },
      48000,
    );
    const out = cookEnvelope(node, pcm, 0, new Map(), 0.18);
    expect(value(out, "rms")).toBeCloseTo(0.09);
    expect(value(out, "energy")).toBeCloseTo(0.5);
    expect(
      value(
        cookEnvelope(
          node,
          makeChannels({ silent: Array(2048).fill(0) }),
          0,
          new Map(),
        ),
        "energy",
      ),
    ).toBe(0);
  });
  it("attacks faster than it releases and resets correctly on a timeline seek", () => {
    const state = new Map(),
      loud = makeChannels({ l: Array(512).fill(0.18) }, 48000),
      silent = makeChannels({ l: Array(512).fill(0) }, 48000);
    cookEnvelope(node, silent, 0, state, 0.18);
    const up = value(cookEnvelope(node, loud, 0.02, state, 0.18), "energy"),
      down = value(cookEnvelope(node, silent, 0.04, state, 0.18), "energy");
    expect(up).toBeGreaterThan(0.6);
    expect(down).toBeGreaterThan(up * 0.9);
    expect(value(cookEnvelope(node, silent, 0, state, 0.18), "energy")).toBe(0);
  });
});
describe("Four-stem choreography and routing", () => {
  it("maps bass to scale and other stems to distinct displacements; silence preserves geometry", () => {
    const silent: Dance = {
      time: 1,
      vocals: 0,
      drums: 0,
      hit: 0,
      bass: 0,
      other: 0,
      pulse: 0.12,
      scale: 0.14,
      ripple: 0.075,
      colorMix: 0.75,
    };
    const p: [number, number, number] = [0.4, 0.5, 0.2],
      n: [number, number, number] = [0, 1, 0];
    expect(displacedPoint(p, n, 0.3, silent)).toEqual(p);
    displacedPoint(p, n, 0.3, { ...silent, bass: 1 }).forEach((v, i) =>
      expect(v).toBeCloseTo(p[i] * 1.14),
    );
    const drum = displacedPoint(p, n, 0.3, { ...silent, hit: 1 });
    expect(drum[0]).toBe(p[0]);
    expect(drum[1]).toBeGreaterThan(p[1]);
    expect(displacedPoint(p, n, 0.3, { ...silent, other: 1 })).not.toEqual(p);
  });
  it("routes each real saved WAV by its stem name rather than the first output", () => {
    const stems = {
      ...node,
      id: "stems",
      type: "local_stems",
      data: {
        label: "stems",
        params: {
          outputs_json: JSON.stringify([
            {
              kind: "audio",
              name: "vocals_00001_.wav",
              url: "/api/assets/v.wav",
            },
            {
              kind: "audio",
              name: "bass_00001_.wav",
              url: "/api/assets/b.wav",
            },
          ]),
        },
      },
    };
    const track = {
      ...node,
      id: "bass",
      type: "stem_track_chop",
      data: { label: "bass", params: { track: "bass" } },
    };
    const project: Project = {
      id: "test",
      name: "test",
      version: 1,
      nodes: [stems, track],
      edges: [
        { id: "link", source: "stems", target: "bass", targetHandle: "in" },
      ],
    };
    expect(trackURL(project, track)).toBe("/api/assets/b.wav");
    expect(performanceAncestors(project, "bass")).toHaveLength(2);
  });
});
