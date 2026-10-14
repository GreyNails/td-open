import { describe, it, expect } from "vitest";
import { pixelsToPointCloud } from "./imagePointCloud";
import {
  summarizeValue,
  mentionedNodes,
  captureNodeRuntime,
} from "../assistantContext";
import type { Project } from "../types";

describe("raster to planar point cloud", () => {
  const width = 100,
    height = 60;
  const vertices = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5,
      r = i % 2 ? 11 : 27;
    return [50 + Math.cos(a) * r, 30 + Math.sin(a) * r];
  });
  const inside = (x: number, y: number) => {
    let result = false;
    for (let i = 0, j = 9; i < 10; j = i++) {
      const a = vertices[i],
        b = vertices[j];
      if (
        a[1] > y !== b[1] > y &&
        x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
      )
        result = !result;
    }
    return result;
  };
  const raster = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raster.set(
        inside(x + 0.5, y + 0.5) ? [255, 255, 255, 255] : [0, 0, 0, 255],
        i,
      );
    }
  it("samples every foreground pixel once, preserves aspect, and never creates off-shape or non-planar points", () => {
    const cloud = pixelsToPointCloud(raster, width, height, { width: 4 }),
      points = cloud.mesh!.positions;
    const expected = Array.from({ length: width * height }, (_, i) =>
      inside((i % width) + 0.5, Math.floor(i / width) + 0.5),
    ).filter(Boolean).length;
    expect(points).toHaveLength(expected);
    expect(expected).toBeGreaterThan(700);
    expect(
      points.every(
        ([x, y, z]) => z === 0 && inside(x / 0.04 + 50, 30 - y / 0.04),
      ),
    ).toBe(true);
    expect(cloud.mesh!.faces).toEqual([]);
    expect(summarizeValue(cloud)).toMatchObject({
      point_count: expected,
      face_count: 0,
      bounds: {
        min: [expect.any(Number), expect.any(Number), 0],
        max: [expect.any(Number), expect.any(Number), 0],
      },
    });
  });
  it("handles inverted and transparent backgrounds; outline is a subset and empty masks stay empty", () => {
    const inverse = raster.map((v, i) => (i % 4 === 3 ? v : 255 - v));
    const original = pixelsToPointCloud(raster, width, height, {}).mesh!
      .positions;
    expect(
      pixelsToPointCloud(inverse, width, height, { mask: "dark" }).mesh!
        .positions,
    ).toEqual(original);
    const alpha = raster.map((v, i) => (i % 4 === 3 ? raster[i - 3] : 255));
    expect(
      pixelsToPointCloud(alpha, width, height, { mask: "alpha" }).mesh!
        .positions,
    ).toEqual(original);
    const outline = pixelsToPointCloud(raster, width, height, {
      region: "outline",
    }).mesh!.positions;
    expect(outline.length).toBeGreaterThan(80);
    expect(outline.length).toBeLessThan(original.length / 2);
    expect(
      pixelsToPointCloud(new Uint8ClampedArray(16), 2, 2, {}).mesh!.positions,
    ).toEqual([]);
  });
});

describe("node mentions and runtime snapshots", () => {
  const project: Project = {
    id: "test",
    name: "test",
    version: 1,
    nodes: [
      {
        id: "source",
        type: "media",
        position: { x: 0, y: 0 },
        data: { label: "五角星", params: {} },
      },
      {
        id: "cloud",
        type: "image_to_pointcloud_sop",
        position: { x: 0, y: 0 },
        data: { label: "点云", params: {} },
      },
    ],
    edges: [
      {
        id: "edge",
        source: "source",
        target: "cloud",
        sourceHandle: "out",
        targetHandle: "in",
      },
    ],
  };
  it("resolves IDs and unique names, deduplicates, and never guesses an ambiguous label", () => {
    expect(mentionedNodes("@source @五角星 @cloud", project)).toEqual([
      "source",
      "cloud",
    ]);
    const duplicate = structuredClone(project);
    duplicate.nodes[1].data.label = "五角星";
    expect(mentionedNodes("@五角星", duplicate)).toEqual([]);
  });
  it("marks unavailable runtime honestly and distinguishes unconnected inputs", () => {
    expect(
      captureNodeRuntime(null, project, ["cloud"])[0].inputs.in,
    ).toMatchObject({ status: "not_cooked" });
    expect(
      captureNodeRuntime(null, { ...project, edges: [] }, ["cloud"])[0].inputs
        .in,
    ).toEqual({ status: "unconnected" });
    expect(summarizeValue("x".repeat(5000))).toMatchObject({
      length: 5000,
      preview: "x".repeat(1200),
    });
  });
});
