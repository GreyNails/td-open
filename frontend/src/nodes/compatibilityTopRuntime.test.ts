import { describe, expect, it } from "vitest";
import { compatibilityTopCatalog } from "./compatibilityTopCatalog";
import {
  applyCompatibilityTopPixels as apply,
  boundaryIndex,
  distortLensPoint,
  hsvToRgbUnclamped,
  invertLensPoint,
  parseBlurKernel,
  rgbRangeWeight,
} from "./compatibilityTopRuntime";

const bytes = (...values: number[]) => new Uint8ClampedArray(values);
const flat = (data: Uint8ClampedArray) => [...data];
const lens = { k1: 0, k2: 0, k3: 0, p1: 0, p2: 0 };

describe("RGB range key and output control", () => {
  it("requires all three independently specified intervals", () => {
    const source = bytes(
      30,
      180,
      50,
      200,
      180,
      180,
      50,
      200,
      30,
      50,
      50,
      200,
      30,
      180,
      200,
      200,
    );
    const result = apply("compat_rgb_key", source, 4, 1, {
      red_min: 0.1,
      red_max: 0.2,
      green_min: 0.6,
      green_max: 0.8,
      blue_min: 0.1,
      blue_max: 0.3,
    });
    expect([result[3], result[7], result[11], result[15]]).toEqual([
      200, 0, 0, 0,
    ]);
    expect(flat(source)).toEqual([
      30, 180, 50, 200, 180, 180, 50, 200, 30, 50, 50, 200, 30, 180, 200, 200,
    ]);
  });
  it("softens both edges independently and rejects inverted intervals", () => {
    expect(rgbRangeWeight(0.2, 0.3, 0.7, 0.2, 0.4)).toBeCloseTo(0.5);
    expect(rgbRangeWeight(0.9, 0.3, 0.7, 0.2, 0.4)).toBeCloseTo(0.5);
    expect(rgbRangeWeight(0.3, 0.3, 0.7, 0.2, 0.4)).toBe(1);
    expect(rgbRangeWeight(0, 0.3, 0.7, 0.2, 0.4)).toBe(0);
    expect(rgbRangeWeight(0.5, 0.7, 0.3, 1, 1)).toBe(0);
  });
  it("inverts the created key and separately selects RGB and alpha outputs", () => {
    const result = apply("compat_rgb_key", bytes(255, 0, 0, 128), 1, 1, {
      green_min: 0.5,
      invert: true,
      rgb_output: "new_alpha",
      alpha_output: "new_alpha",
    });
    expect(flat(result)).toEqual([255, 255, 255, 255]);
    expect(
      flat(
        apply("compat_rgb_key", bytes(255, 255, 255, 100), 1, 1, {
          red_max: 0.8,
          red_soft_high: 0.4,
          rgb_output: "multiply_alpha",
        }),
      ),
    ).toEqual([128, 128, 128, 50]);
  });
});

describe("camera distortion and inverse sampling", () => {
  it("uses radial k1, k2 and k3 polynomial terms", () => {
    const point = distortLensPoint(0.4, 0.3, {
      ...lens,
      k1: 0.1,
      k2: 0.2,
      k3: 0.3,
    });
    const radial = 1 + 0.1 * 0.25 + 0.2 * 0.25 ** 2 + 0.3 * 0.25 ** 3;
    expect(point[0]).toBeCloseTo(0.4 * radial, 12);
    expect(point[1]).toBeCloseTo(0.3 * radial, 12);
  });
  it("uses both tangential terms, including their asymmetric squared components", () => {
    expect(distortLensPoint(0.4, 0.3, { ...lens, p1: 0.2, p2: -0.1 })).toEqual([
      0.391, 0.362,
    ]);
  });
  it("numerically inverts all five coefficients with a small residual", () => {
    const coefficients = { k1: 0.12, k2: -0.04, k3: 0.01, p1: 0.03, p2: -0.02 };
    for (const [x, y] of [
      [0.4, -0.3],
      [-0.8, 0.5],
      [0, 0],
      [1.2, 0.1],
    ]) {
      const [dx, dy] = distortLensPoint(x, y, coefficients),
        inverted = invertLensPoint(dx, dy, coefficients);
      expect(inverted).toBeDefined();
      expect(inverted![0]).toBeCloseTo(x, 6);
      expect(inverted![1]).toBeCloseTo(y, 6);
    }
  });
  it("preserves identity including transparent RGB without subpixel shifts", () => {
    const source = bytes(
      15,
      30,
      45,
      0,
      50,
      100,
      150,
      255,
      99,
      55,
      11,
      80,
      200,
      140,
      30,
      255,
    );
    expect(
      apply("compat_lens_distort", source, 2, 2, {
        cx: 0.2,
        cy: 0.8,
        fx: 0.1,
        fy: 3,
      }),
    ).toEqual(source);
  });
  it("applies focal length and principal point in normalized pixel-center coordinates", () => {
    const source = new Uint8ClampedArray(9 * 9 * 4);
    for (let y = 0; y < 9; y++)
      for (let x = 0; x < 9; x++)
        source.set([x * 25, y * 25, 50, 255], (y * 9 + x) * 4);
    const params = {
      k1: 0.2,
      k2: 0.1,
      k3: 0.05,
      p1: 0.1,
      p2: -0.1,
      cx: 0.3,
      cy: 0.6,
      fx: 0.7,
      fy: 0.8,
      filter: "nearest",
    };
    const result = apply("compat_lens_distort", source, 9, 9, params),
      x = 6,
      y = 4;
    const nx = ((x + 0.5) / 9 - 0.3) / 0.7,
      ny = ((y + 0.5) / 9 - 0.6) / 0.8,
      r2 = nx ** 2 + ny ** 2,
      radial = 1 + 0.2 * r2 + 0.1 * r2 ** 2 + 0.05 * r2 ** 3;
    const dx = nx * radial + 0.2 * nx * ny - 0.1 * (r2 + 2 * nx ** 2),
      dy = ny * radial + 0.1 * (r2 + 2 * ny ** 2) - 0.2 * nx * ny;
    const sx = Math.round((dx * 0.7 + 0.3) * 9 - 0.5),
      sy = Math.round((dy * 0.8 + 0.6) * 9 - 0.5);
    expect(flat(result.slice((y * 9 + x) * 4, (y * 9 + x) * 4 + 4))).toEqual([
      sx * 25,
      sy * 25,
      50,
      255,
    ]);
  });
  it("handles non-finite inverse coordinates without fabricating samples", () => {
    expect(invertLensPoint(Infinity, 0, lens)).toBeUndefined();
  });
});

describe("Level, Reorder and real HSV adjustments", () => {
  it("combines black/white, gamma, brightness, contrast and opacity in a defined order", () => {
    const source = bytes(64, 128, 192, 200),
      params = {
        black: 0.1,
        white: 0.9,
        gamma: 2,
        brightness: -0.1,
        contrast: 1.2,
        pivot: 0.4,
        opacity: 0.25,
      };
    const expected = [64, 128, 192].map(
      (v) => ((Math.sqrt((v / 255 - 0.1) / 0.8) - 0.1 - 0.4) * 1.2 + 0.4) * 255,
    );
    expect(apply("compat_level", source, 1, 1, params)).toEqual(
      bytes(...expected, 50),
    );
  });
  it("validates black/white order and clips final output", () => {
    expect(() =>
      apply("compat_level", bytes(0, 128, 255, 255), 1, 1, {
        black: 0.5,
        white: 0.5,
      }),
    ).toThrow(/白点/);
    expect(
      flat(
        apply("compat_level", bytes(0, 128, 255, 255), 1, 1, { contrast: 8 }),
      ),
    ).toEqual([0, 132, 255, 255]);
  });
  it("reads RGBA from the original pixel and permits constants in all outputs", () => {
    const source = bytes(10, 20, 30, 40);
    expect(
      flat(
        apply("compat_reorder", source, 1, 1, {
          r: "A",
          g: "R",
          b: "1",
          a: "0",
        }),
      ),
    ).toEqual([40, 10, 255, 0]);
    expect(
      flat(
        apply("compat_reorder", source, 1, 1, {
          r: "B",
          g: "A",
          b: "R",
          a: "G",
        }),
      ),
    ).toEqual([30, 40, 10, 20]);
  });
  it("rotates primary colors using HSV, preserves alpha and wraps hue", () => {
    expect(
      flat(
        apply(
          "compat_hsv_adjust",
          bytes(255, 0, 0, 111, 0, 255, 0, 222),
          2,
          1,
          { hue: 120 },
        ),
      ),
    ).toEqual([0, 255, 0, 111, 0, 0, 255, 222]);
    expect(
      flat(
        apply("compat_hsv_adjust", bytes(0, 0, 255, 99), 1, 1, { hue: -120 }),
      ),
    ).toEqual([0, 255, 0, 99]);
  });
  it("applies saturation/value offsets and optionally clips before RGB conversion", () => {
    const source = bytes(128, 64, 64, 255);
    expect(
      flat(
        apply("compat_hsv_adjust", source, 1, 1, { saturation: 0, value: 0.5 }),
      ),
    ).toEqual([64, 64, 64, 255]);
    const clamped = apply("compat_hsv_adjust", source, 1, 1, {
      saturation_offset: 0.25,
      value: 3,
      clamp: true,
    });
    const unclamped = apply("compat_hsv_adjust", source, 1, 1, {
      saturation_offset: 0.25,
      value: 3,
      clamp: false,
    });
    expect(flat(clamped)).toEqual([255, 64, 64, 255]);
    expect(flat(unclamped)).toEqual([255, 96, 96, 255]);
    expect(hsvToRgbUnclamped(0, 1.2, 2)).toEqual([
      2, -0.3999999999999999, -0.3999999999999999,
    ]);
  });
});

describe("Matte and Inside channels", () => {
  it("uses second input alpha and supports separate rgba/alpha multiplication", () => {
    const source = bytes(200, 100, 50, 200),
      mask = bytes(255, 255, 255, 128);
    expect(flat(apply("compat_inside", source, 1, 1, {}, mask))).toEqual([
      100, 50, 25, 100,
    ]);
    expect(
      flat(apply("compat_inside", source, 1, 1, { affect: "alpha" }, mask)),
    ).toEqual([200, 100, 50, 100]);
    expect(
      flat(
        apply(
          "compat_inside",
          source,
          1,
          1,
          { affect: "alpha", invert: true },
          mask,
        ),
      ),
    ).toEqual([200, 100, 50, 100]);
  });
  it("computes luminance independently of mask alpha and supports inversion", () => {
    const result = apply(
      "compat_inside",
      bytes(200, 100, 50, 255),
      1,
      1,
      { channel: "luminance", affect: "alpha", invert: true },
      bytes(0, 255, 0, 0),
    );
    expect(flat(result)).toEqual([200, 100, 50, 73]);
  });
  it("blends a foreground and background using the matte without black transparent halos", () => {
    const source = bytes(255, 0, 0, 128),
      background = bytes(0, 0, 255, 255),
      mask = bytes(0, 0, 0, 128);
    const result = apply("compat_matte", source, 1, 1, {}, mask, background);
    const af = (128 / 255) ** 2,
      ab = 127 / 255;
    expect(result).toEqual(
      bytes((255 * af) / (af + ab), 0, (255 * ab) / (af + ab), 255 * (af + ab)),
    );
    expect(flat(apply("compat_matte", source, 1, 1, {}, mask))).toEqual([
      255, 0, 0, 64,
    ]);
  });
  it("provides all declared mask selectors and clear output with an absent mask", () => {
    const source = bytes(255, 255, 255, 255),
      mask = bytes(51, 102, 153, 204);
    for (const [channel, expected] of [
      ["red", 51],
      ["green", 102],
      ["blue", 153],
      ["rgb_average", 102],
      ["rgba_average", 128],
      ["rgb_max", 153],
      ["rgba_max", 204],
    ] as const)
      expect(apply("compat_inside", source, 1, 1, { channel }, mask)[3]).toBe(
        expected,
      );
    expect(flat(apply("compat_matte", source, 1, 1))).toEqual([0, 0, 0, 0]);
  });
});

describe("convolution and boundary policies", () => {
  it("implements clamp, wrapped, reflected and transparent edges", () => {
    expect(
      ["clamp", "wrap", "mirror", "transparent"].map((mode) =>
        boundaryIndex(-2, 4, mode as "clamp"),
      ),
    ).toEqual([0, 2, 1, -1]);
    expect(
      ["clamp", "wrap", "mirror", "transparent"].map((mode) =>
        boundaryIndex(5, 4, mode as "clamp"),
      ),
    ).toEqual([3, 1, 2, -1]);
    expect(boundaryIndex(-999, 1, "mirror")).toBe(0);
  });
  it("normalizes custom kernels and rejects malformed or negative blur weights", () => {
    expect(parseBlurKernel("[[1,2,1],[2,4,2],[1,2,1]]")[1][1]).toBe(0.25);
    for (const raw of [
      "no",
      "[[1,2]]",
      "[[0]]",
      "[[-1]]",
      "[[1,2],[3,4]]",
      "[[1e309]]",
    ])
      expect(() => parseBlurKernel(raw)).toThrow();
  });
  it("box-blurs a known impulse and conserves an opaque constant", () => {
    const source = bytes(0, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 255);
    expect(
      flat(apply("compat_blur", source, 3, 1, { method: "box", radius: 1 })),
    ).toEqual([85, 0, 0, 255, 85, 0, 0, 255, 85, 0, 0, 255]);
    const constant = bytes(
      ...Array.from({ length: 9 }, () => [64, 128, 192, 255]).flat(),
    );
    for (const method of ["box", "gaussian", "custom"])
      for (const boundary of ["clamp", "mirror", "wrap"])
        expect(
          apply("compat_blur", constant, 3, 3, { method, radius: 3, boundary }),
        ).toEqual(constant);
  });
  it("has Gaussian impulse weights, symmetry and greater center concentration", () => {
    const source = bytes(0, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 255);
    const result = apply("compat_blur", source, 3, 1, { radius: 1, sigma: 1 });
    const center = 255 / (1 + 2 * Math.exp(-0.5));
    expect(result[4]).toBe(Math.round(center));
    expect(result[0]).toBe(result[8]);
    expect(result[4]).toBeGreaterThan(result[0]);
  });
  it("uses custom weights, transparency at edges, and premultiplication to prevent black halos", () => {
    const source = bytes(0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0);
    const result = apply("compat_blur", source, 3, 1, {
      method: "custom",
      kernel: "[[0,0,0],[1,1,1],[0,0,0]]",
    });
    expect(flat(result)).toEqual([255, 0, 0, 85, 255, 0, 0, 85, 255, 0, 0, 85]);
    expect(
      flat(
        apply("compat_blur", bytes(255, 0, 0, 255), 1, 1, {
          method: "box",
          radius: 1,
          boundary: "transparent",
        }),
      ),
    ).toEqual([255, 0, 0, 28]);
    expect(
      flat(
        apply("compat_blur", source, 3, 1, {
          method: "box",
          radius: 1,
          premultiply: false,
        }),
      ),
    ).toEqual([85, 0, 0, 85, 85, 0, 0, 85, 85, 0, 0, 85]);
  });
});

describe("registered RGBA8 subsets", () => {
  it("all eight declarations cook default images and disclose their subset", () => {
    const source = bytes(50, 100, 150, 200, 200, 150, 100, 50);
    expect(compatibilityTopCatalog).toHaveLength(8);
    for (const spec of compatibilityTopCatalog) {
      expect(spec.reference?.level).toBe("subset");
      expect(spec.reference?.note).toContain("RGBA8");
      expect(apply(spec.type, source, 2, 1, {}, source)).toHaveLength(8);
    }
  });
  it("validates pixel dimensions and finite numeric parameters", () => {
    expect(() => apply("compat_inside", bytes(1, 2, 3, 4), 2, 1)).toThrow(
      /尺寸/,
    );
    expect(() =>
      apply("compat_inside", bytes(1, 2, 3, 4), 1, 1, {}, bytes(1, 2)),
    ).toThrow(/尺寸/);
    expect(
      apply("compat_level", bytes(12, 34, 56, 78), 1, 1, { gamma: "NaN" }),
    ).toEqual(bytes(12, 34, 56, 78));
    expect(() => apply("unknown", bytes(1, 2, 3, 4), 1, 1)).toThrow(/Unknown/);
  });
});
