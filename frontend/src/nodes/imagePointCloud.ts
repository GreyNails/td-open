import type { GraphNode, Params } from "../types";
import { isGeometrySpec, type Vec3 } from "./geometry";
import type { PointCloudSpec } from "./pointPerformance";

/** Sample the existing raster, never infer geometry or generate a new image. */
export function pixelsToPointCloud(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  p: Params,
): PointCloudSpec {
  if (
    width < 1 ||
    height < 1 ||
    width * height > 262144 ||
    pixels.length !== width * height * 4
  )
    throw new Error("图像采样尺寸不正确或超过 262144 像素");
  const threshold = Number(p.threshold ?? 0.5),
    mode = String(p.mask ?? "bright"),
    scale = Number(p.width ?? 3) / width,
    positions: Vec3[] = [],
    colors: number[][] = [],
    uv: number[][] = [];
  const occupied = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const i = (y * width + x) * 4,
      alpha = pixels[i + 3] / 255;
    const luminance =
      (pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722) /
      255;
    return (
      alpha > 0.01 &&
      (mode === "alpha"
        ? alpha >= threshold
        : mode === "dark"
          ? luminance <= threshold
          : luminance >= threshold)
    );
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!occupied(x, y)) continue;
      if (
        p.region === "outline" &&
        occupied(x - 1, y) &&
        occupied(x + 1, y) &&
        occupied(x, y - 1) &&
        occupied(x, y + 1)
      )
        continue;
      const i = (y * width + x) * 4;
      positions.push([
        (x + 0.5 - width / 2) * scale,
        (height / 2 - y - 0.5) * scale,
        0,
      ]);
      colors.push([pixels[i] / 255, pixels[i + 1] / 255, pixels[i + 2] / 255]);
      uv.push([(x + 0.5) / width, 1 - (y + 0.5) / height]);
    }
  return {
    shape: "mesh",
    detail: 1,
    pointCloud: true,
    mesh: {
      positions,
      faces: [],
      pointAttributes: { Cd: colors, uv, N: positions.map(() => [0, 0, 1]) },
    },
  };
}

export function cookImagePointCloud(
  node: GraphNode,
  input: unknown,
  state: Map<string, unknown>,
): PointCloudSpec | HTMLCanvasElement {
  const p = node.data.params;
  let canvas = state.get("image_points_canvas") as
    HTMLCanvasElement | undefined;
  if (!canvas) {
    canvas = document.createElement("canvas");
    state.set("image_points_canvas", canvas);
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  if (node.type === "image_to_pointcloud_sop") {
    if (!(input instanceof HTMLCanvasElement))
      throw new Error("请将原始图片 TOP 连接到图像输入");
    const size = Math.max(
      8,
      Math.min(512, Math.round(Number(p.resolution) || 160)),
    );
    const ratio = Math.min(1, size / Math.max(input.width, input.height));
    canvas.width = Math.max(1, Math.round(input.width * ratio));
    canvas.height = Math.max(1, Math.round(input.height * ratio));
    ctx.drawImage(input, 0, 0, canvas.width, canvas.height);
    let bytes: Uint8ClampedArray;
    try {
      bytes = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    } catch {
      throw new Error(
        "无法读取图片像素，请上传图片到工作台，或使用允许跨域读取的图片地址",
      );
    }
    const previous = state.get("image_points_bytes") as
      Uint8ClampedArray | undefined;
    const key = JSON.stringify([canvas.width, canvas.height, p]);
    if (
      state.get("image_points_key") === key &&
      previous?.length === bytes.length &&
      bytes.every((v, i) => v === previous[i])
    )
      return state.get("image_points_cloud") as PointCloudSpec;
    const cloud = pixelsToPointCloud(bytes, canvas.width, canvas.height, p);
    state.set("image_points_key", key);
    state.set("image_points_bytes", bytes);
    state.set("image_points_cloud", cloud);
    return cloud;
  }
  if (!isGeometrySpec(input) || !input.mesh)
    throw new Error("请连接带有点坐标的 SOP 点云");
  canvas.width = 960;
  canvas.height = 540;
  ctx.fillStyle = String(p.background || "#080d1b");
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const scale = canvas.width / Math.max(0.1, Number(p.view_width) || 4),
    radius = Math.max(0.3, Number(p.point_size) || 1.2);
  const colors = input.mesh.pointAttributes?.Cd;
  for (const [i, point] of input.mesh.positions.entries()) {
    ctx.fillStyle =
      p.source_color && colors?.[i]
        ? `rgb(${colors[i]
            .slice(0, 3)
            .map((v) => Math.round(v * 255))
            .join(",")})`
        : String(p.color || "#ffd598");
    ctx.beginPath();
    ctx.arc(
      canvas.width / 2 + point[0] * scale,
      canvas.height / 2 - point[1] * scale,
      radius,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  return canvas;
}
