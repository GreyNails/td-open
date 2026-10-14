import { StudioEngine } from "./src/engine";
import { pointCloudPLY } from "./src/nodes/pointPerformance";
export async function verify(project: any) {
  const engine = new StudioEngine(project);
  try {
    let canvas = engine.render(0);
    const sourceId = project.nodes.find((n: any) => n.type === "media").id;
    for (let i = 0; i < 50; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      canvas = engine.render(0);
      const src = engine.values.get(sourceId) as HTMLCanvasElement;
      if (src.getContext("2d")!.getImageData(320, 180, 1, 1).data[0] === 255)
        break;
    }
    const cloudNode = project.nodes.find(
      (n: any) => n.type === "image_to_pointcloud_sop",
    );
    const cloud: any = engine.values.get(cloudNode.id),
      source = engine.values.get(sourceId) as HTMLCanvasElement;
    if (engine.errors.size) throw new Error(JSON.stringify([...engine.errors]));
    if (!cloud.mesh?.positions.length) throw new Error("No points");
    const sample = document.createElement("canvas");
    sample.width = 200;
    sample.height = Math.round((360 * 200) / 640);
    const ctx = sample.getContext("2d")!;
    ctx.drawImage(source, 0, 0, sample.width, sample.height);
    const pixels = ctx.getImageData(0, 0, sample.width, sample.height).data;
    let expected = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] >= 127.5) expected++;
    const allValid = cloud.mesh.positions.every(([x, y, z]: number[]) => {
      const px = Math.round(x / (3 / 200) + 100 - 0.5),
        py = Math.round(sample.height / 2 - 0.5 - y / (3 / 200));
      return z === 0 && pixels[(py * 200 + px) * 4] >= 127.5;
    });
    if (!allValid || expected !== cloud.mesh.positions.length)
      throw new Error("Star pixel / point mismatch");
    return {
      point_count: cloud.mesh.positions.length,
      expected_foreground_pixels: expected,
      all_points_in_mask: allValid,
      z_min: 0,
      z_max: 0,
      errors: [...engine.errors],
      png: canvas.toDataURL("image/png"),
      webp: canvas.toDataURL("image/webp", 0.9),
      ply: pointCloudPLY(cloud),
    };
  } finally {
    engine.dispose();
  }
}
