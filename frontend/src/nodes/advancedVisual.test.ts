import { describe, expect, it } from "vitest";
import { advancedVisualCatalog } from "./advancedVisualCatalog";
import {
  advancedGeneratorValue,
  advancedParameters,
  neighborhoodPixels,
  processAdvancedPixels,
} from "./advancedVisual";
const process = (type: string, pixels: number[], params = {}) => {
  const data = new Uint8ClampedArray(pixels);
  expect(processAdvancedPixels(type, data, params)).toBe(true);
  return [...data];
};
describe("advanced color operations", () => {
  it("rotates red to green and preserves neutral colors and alpha", () => {
    expect(process("hue_shift", [255, 0, 0, 71], { angle: 120 })).toEqual([
      0, 255, 0, 71,
    ]);
    expect(process("hue_shift", [90, 90, 90, 71], { angle: 193 })).toEqual([
      90, 90, 90, 71,
    ]);
  });
  it("desaturates with perceptual luma", () => {
    expect(process("saturation", [255, 0, 0, 17], { amount: 0 })).toEqual([
      54, 54, 54, 17,
    ]);
  });
  it("adds brightness and multiplies exposure by photographic stops", () => {
    expect(process("brightness", [10, 20, 200, 61], { amount: 0.2 })).toEqual([
      61, 71, 251, 61,
    ]);
    expect(process("exposure", [10, 20, 200, 61], { stops: 1 })).toEqual([
      20, 40, 255, 61,
    ]);
    expect(process("exposure", [10, 20, 200, 61], { stops: -1 })).toEqual([
      5, 10, 100, 61,
    ]);
  });
  it("maps black and white to duotone endpoints", () => {
    expect(
      process("duotone", [0, 0, 0, 31, 255, 255, 255, 52], {
        background: "#112233",
        color: "#ddeeff",
      }),
    ).toEqual([17, 34, 51, 31, 221, 238, 255, 52]);
  });
  it("solarizes only channels above threshold", () => {
    expect(
      process("solarize", [10, 130, 240, 80], { threshold: 0.5, amount: 1 }),
    ).toEqual([10, 125, 15, 80]);
  });
  it("supports independent channel routing including constants", () => {
    expect(
      process("channel_shuffle", [10, 20, 30, 91], {
        red: "alpha",
        green: "zero",
        blue: "one",
      }),
    ).toEqual([91, 0, 255, 91]);
    expect(
      process("channel_extract", [10, 20, 30, 91], { channel: "blue" }),
    ).toEqual([30, 30, 30, 91]);
  });
  it("preserves source opacity in luminance key", () => {
    const pixels = [30, 30, 30, 81, 210, 210, 210, 67];
    expect(
      process("luma_key", pixels, {
        threshold: 0.5,
        softness: 0,
        keep: "bright",
      }),
    ).toEqual([30, 30, 30, 0, 210, 210, 210, 67]);
    expect(
      process("luma_key", pixels, {
        threshold: 0.5,
        softness: 0,
        keep: "dark",
      }),
    ).toEqual([30, 30, 30, 81, 210, 210, 210, 0]);
  });
  it("reaches both color curve endpoints", () => {
    const result = process("color_curve", [0, 127, 255, 55], {
      shadows: 0.2,
      midtones: 0.5,
      highlights: 0.8,
    });
    expect(result[0]).toBe(51);
    expect(result[1]).toBe(127);
    expect(result[2]).toBe(204);
    expect(result[3]).toBe(55);
  });
  it("selects closest palette color and supports neutral mix", () => {
    expect(
      process("color_quantize", [10, 75, 250, 71], {
        palette: "mono",
        amount: 1,
      }),
    ).toEqual([85, 85, 85, 71]);
    expect(process("color_quantize", [10, 75, 250, 71], { amount: 0 })).toEqual(
      [10, 75, 250, 71],
    );
  });
  it("sanitizes imported invalid parameters and rejects unsupported operations", () => {
    expect(advancedParameters("exposure", { stops: Infinity })).toEqual({
      stops: 1,
    });
    expect(
      advancedParameters("channel_extract", { channel: "invalid" }),
    ).toEqual({ channel: "red" });
    expect(advancedParameters("duotone", { color: "nonsense" }).color).toBe(
      "#c8a4ff",
    );
    expect(processAdvancedPixels("unknown", new Uint8ClampedArray(4), {})).toBe(
      false,
    );
  });
});
describe("spatial filters", () => {
  const impulse = new Uint8ClampedArray(3 * 3 * 4);
  for (let i = 3; i < impulse.length; i += 4) impulse[i] = 79;
  impulse.set([255, 150, 90, 79], 16);
  it("median removes isolated impulse without destroying alpha", () => {
    expect([
      ...neighborhoodPixels("median_filter", impulse, 3, 3, 1).slice(16, 20),
    ]).toEqual([0, 0, 0, 79]);
  });
  it("dilation grows an impulse and erosion shrinks it", () => {
    const dilated = neighborhoodPixels("dilate", impulse, 3, 3, 1),
      eroded = neighborhoodPixels("erode", impulse, 3, 3, 1);
    for (let i = 0; i < impulse.length; i += 4) {
      expect([...dilated.slice(i, i + 4)]).toEqual([255, 150, 90, 79]);
      expect([...eroded.slice(i, i + 4)]).toEqual([0, 0, 0, 79]);
    }
  });
});
describe("procedural fields", () => {
  const fields = advancedVisualCatalog.filter((spec) =>
    spec.inputs.every((port) => port.kind !== "TOP"),
  );
  it("registers 47 unique operators including 11 field generators", () => {
    expect(advancedVisualCatalog).toHaveLength(47);
    expect(new Set(advancedVisualCatalog.map((spec) => spec.type)).size).toBe(
      47,
    );
    expect(fields).toHaveLength(11);
  });
  it("produces finite bounded and spatially varied fields", () => {
    for (const spec of fields) {
      const p = advancedParameters(spec.type, {}),
        values = [];
      for (let y = 0; y < 10; y++)
        for (let x = 0; x < 16; x++) {
          const value = advancedGeneratorValue(
            spec.type,
            x / 16,
            y / 10,
            0.37,
            0,
            p,
          );
          expect(value, spec.type).toBeGreaterThanOrEqual(0);
          expect(value, spec.type).toBeLessThanOrEqual(1);
          values.push(value);
        }
      expect(new Set(values).size, spec.type).toBeGreaterThan(1);
    }
  });
  it("uses deterministic seeded noise", () => {
    const p = advancedParameters("fbm_noise", {}),
      first = advancedGeneratorValue("fbm_noise", 0.234, 0.765, 1.3, 0, p);
    expect(advancedGeneratorValue("fbm_noise", 0.234, 0.765, 1.3, 0, p)).toBe(
      first,
    );
    expect(
      advancedGeneratorValue("fbm_noise", 0.234, 0.765, 1.3, 0, {
        ...p,
        seed: 99,
      }),
    ).not.toBe(first);
  });
});
