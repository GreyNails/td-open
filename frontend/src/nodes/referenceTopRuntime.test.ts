import { describe, it, expect } from "vitest";
import {
  fft1D,
  fft2D,
  convolvePixels,
  findBlobs,
  solveHomography,
  rgbToHSV,
  hsvToRGB,
  opticalFlow,
} from "./referenceTopRuntime";
const rgba = (w: number, h: number, fn: (x: number, y: number) => number) => {
  const p = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      p[i] = p[i + 1] = p[i + 2] = fn(x, y);
      p[i + 3] = 255;
    }
  return p;
};
describe("image Fourier transforms", () => {
  it("preserves amplitude and reconstructs 1D data", () => {
    const r = new Float64Array([1, 0, -1, 0, 1, 0, -1, 0]),
      original = r.slice(),
      i = new Float64Array(8);
    fft1D(r, i);
    expect(Math.abs(r[2])).toBeCloseTo(4);
    fft1D(r, i, true);
    for (let k = 0; k < 8; k++) expect(r[k]).toBeCloseTo(original[k], 12);
  });
  it("performs a true separable 2D FFT and inverse", () => {
    const size = 16,
      real = Float64Array.from(
        { length: size * size },
        (_, i) => Math.sin(i * 0.3) + Math.cos(i * 0.7),
      ),
      image = { size, real, imag: new Float64Array(real.length) },
      spectrum = fft2D(image),
      restored = fft2D(spectrum, true);
    expect(spectrum.real).not.toEqual(real);
    for (let i = 0; i < real.length; i++)
      expect(restored.real[i]).toBeCloseTo(real[i], 10);
  });
  it("places DC energy at origin and rejects invalid sizes", () => {
    const value = fft2D({
      size: 8,
      real: new Float64Array(64).fill(0.5),
      imag: new Float64Array(64),
    });
    expect(value.real[0]).toBe(32);
    expect([...value.real.slice(1)]).toEqual(new Array(63).fill(0));
    expect(() => fft1D(new Float64Array(3), new Float64Array(3))).toThrow();
  });
});
describe("image-space analysis", () => {
  it("convolves real neighborhoods and preserves alpha", () => {
    const input = rgba(3, 3, (x, y) => (x === 1 && y === 1 ? 255 : 0)),
      out = convolvePixels(
        input,
        3,
        3,
        [
          [1, 1, 1],
          [1, 1, 1],
          [1, 1, 1],
        ],
        9,
      );
    expect(out[16]).toBe(28);
    expect(out[19]).toBe(255);
    expect(() => convolvePixels(input, 3, 3, [[1]], 1)).toThrow();
    expect(() =>
      convolvePixels(
        input,
        3,
        3,
        [
          [0, 0, 0],
          [0, 1, 0],
          [0, 0, 0],
        ],
        0,
      ),
    ).toThrow();
  });
  it("finds independent connected components and correct centroids", () => {
    const data = rgba(8, 8, (x, y) =>
        (x < 2 && y < 3) || (x >= 5 && y >= 5) ? 255 : 0,
      ),
      regions = findBlobs(data, 8, 8, 0.5, 2);
    expect(regions.map((r) => r.area)).toEqual([9, 6]);
    expect(regions[0]).toMatchObject({
      x: 5,
      y: 5,
      width: 3,
      height: 3,
      cx: 6,
      cy: 6,
    });
    expect(findBlobs(data, 8, 8, 0.5, 7)).toHaveLength(1);
  });
  it("solves an inverse projective transform for a trapezoid", () => {
    const points = [
        [0.1, 0.2],
        [0.9, 0],
        [1, 1],
        [0, 0.9],
      ],
      m = solveHomography(points),
      expected = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ];
    points.forEach(([x, y], i) => {
      const den = m[6] * x + m[7] * y + 1;
      expect((m[0] * x + m[1] * y + m[2]) / den).toBeCloseTo(
        expected[i][0],
        10,
      );
      expect((m[3] * x + m[4] * y + m[5]) / den).toBeCloseTo(
        expected[i][1],
        10,
      );
    });
    expect(() =>
      solveHomography([
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ]),
    ).toThrow();
  });
  it("round trips RGB and HSV", () => {
    for (const rgb of [
      [1, 0, 0],
      [0.2, 0.6, 0.8],
      [0.4, 0.4, 0.4],
      [0, 0, 0],
    ]) {
      const hsv = rgbToHSV(...(rgb as [number, number, number])),
        restored = hsvToRGB(...(hsv as [number, number, number]));
      restored.forEach((v, i) => expect(v).toBeCloseTo(rgb[i], 10));
    }
  });
  it("estimates rightward motion from two actual image frames", () => {
    const w = 24,
      h = 24,
      frame = (offset: number) =>
        rgba(
          w,
          h,
          (x, y) =>
            Math.exp(-((x - 12 - offset) ** 2 + (y - 12) ** 2) / 28) * 255,
        ),
      flow = opticalFlow(frame(0), frame(1), w, h, 3);
    let sx = 0,
      sy = 0,
      n = 0;
    for (let y = 8; y < 16; y++)
      for (let x = 8; x < 16; x++) {
        sx += flow[(y * w + x) * 2];
        sy += flow[(y * w + x) * 2 + 1];
        n++;
      }
    expect(sx / n).toBeGreaterThan(0.7);
    expect(sx / n).toBeLessThan(1.4);
    expect(Math.abs(sy / n)).toBeLessThan(0.15);
    const flat = opticalFlow(frame(0), frame(0), w, h, 2);
    expect([...flat].every((v) => v === 0)).toBe(true);
  });
});
