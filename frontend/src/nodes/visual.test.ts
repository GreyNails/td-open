import { describe, expect, it } from "vitest";
import { processColorPixels } from "./visual";
import { visualCatalog } from "./visualCatalog";

describe("visual pixel operators", () => {
  it("inverts RGB while preserving alpha, and supports a neutral mix", () => {
    const pixel = new Uint8ClampedArray([10, 80, 200, 91]);
    processColorPixels("invert", pixel, { amount: 1 });
    expect([...pixel]).toEqual([245, 175, 55, 91]);
    processColorPixels("invert", pixel, { amount: 0 });
    expect([...pixel]).toEqual([245, 175, 55, 91]);
  });
  it("uses perceptual brightness for black and white", () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    processColorPixels("grayscale", pixels, {});
    expect([...pixels]).toEqual([54, 54, 54, 255, 182, 182, 182, 255]);
  });
  it("thresholds at the selected brightness without changing alpha", () => {
    const pixels = new Uint8ClampedArray([
      100, 100, 100, 200, 150, 150, 150, 255,
    ]);
    processColorPixels("threshold", pixels, { threshold: 0.5, softness: 0 });
    expect([...pixels]).toEqual([0, 0, 0, 200, 255, 255, 255, 255]);
  });
  it("quantizes posterize to the selected number of levels", () => {
    const pixels = new Uint8ClampedArray([10, 90, 250, 255]);
    processColorPixels("posterize", pixels, { steps: 3 });
    expect([...pixels]).toEqual([0, 128, 255, 255]);
  });
  it("gamma brightens midtones and preserves both endpoints", () => {
    const pixels = new Uint8ClampedArray([0, 64, 255, 255]);
    processColorPixels("gamma", pixels, { gamma: 2 });
    expect([...pixels]).toEqual([0, 128, 255, 255]);
  });
  it("zero contrast yields the pivot while retaining transparency", () => {
    const pixels = new Uint8ClampedArray([0, 64, 255, 80]);
    processColorPixels("contrast", pixels, { amount: 0, pivot: 0.4 });
    expect([...pixels]).toEqual([102, 102, 102, 80]);
  });
  it("levels maps selected input endpoints to output endpoints", () => {
    const pixels = new Uint8ClampedArray([51, 128, 204, 255]);
    processColorPixels("levels", pixels, {
      black: 0.2,
      white: 0.8,
      gamma: 1,
      out_black: 0.1,
      out_white: 0.9,
    });
    expect(pixels[0]).toBe(26);
    expect(pixels[1]).toBeGreaterThanOrEqual(127);
    expect(pixels[1]).toBeLessThanOrEqual(129);
    expect(pixels[2]).toBe(230);
  });
  it("green key removes green but retains a foreground color and original alpha", () => {
    const pixels = new Uint8ClampedArray([0, 255, 0, 255, 255, 0, 0, 128]);
    processColorPixels("chroma_key", pixels, {
      color: "#00ff00",
      tolerance: 0.1,
      softness: 0,
    });
    expect(pixels[3]).toBe(0);
    expect(pixels[7]).toBe(128);
  });
  it("clamps malformed imported parameters and handles reversed input levels", () => {
    const pixels = new Uint8ClampedArray([0, 128, 255, 255]);
    processColorPixels("gamma", pixels, { gamma: Number.NaN });
    expect(pixels[0]).toBe(0);
    expect(pixels[2]).toBe(255);
    processColorPixels("levels", pixels, { black: 0.9, white: 0.1 });
    expect([...pixels]).toEqual([0, 0, 255, 255]);
  });
  it("does not claim to cook an unsupported pixel operation", () => {
    const pixels = new Uint8ClampedArray([1, 2, 3, 4]);
    expect(processColorPixels("unregistered", pixels, {})).toBe(false);
    expect([...pixels]).toEqual([1, 2, 3, 4]);
  });
  it("registers distinct TOP operators with usable defaults and compatible ports", () => {
    expect(visualCatalog.length).toBe(38);
    expect(new Set(visualCatalog.map((s) => s.type)).size).toBe(38);
    for (const spec of visualCatalog) {
      expect(spec.family).toBe("TOP");
      expect(spec.outputs).toEqual([{ id: "out", kind: "TOP", label: "画面" }]);
      expect(new Set(spec.params.map((p) => p.key)).size).toBe(
        spec.params.length,
      );
      for (const p of spec.params)
        if (p.type === "number") {
          expect(p.default).toBeGreaterThanOrEqual(p.min!);
          expect(p.default).toBeLessThanOrEqual(p.max!);
        }
    }
  });
});
