import { api, type Params, type Project } from "./types";
import { localNodeProfile } from "./nodes/localAICatalog";
import { performanceAncestors } from "./nodes/stemPerformance";
import { localResult, type LocalJob } from "./LocalAI";
export type PerformanceProgress = {
  busy: boolean;
  message: string;
  jobId?: string;
};
export async function generatePerformance(
  project: Project,
  stageId: string,
  rootId: string,
  path: string[],
  patch: (id: string, params: Params) => void,
  progress: (status: PerformanceProgress) => void,
  stillCurrent: () => boolean,
) {
  const snapshot = structuredClone(project),
    ancestors = performanceAncestors(snapshot, stageId),
    generators = ancestors.filter((n) =>
      ["local_image", "local_3d", "local_music", "local_stems"].includes(
        n.type,
      ),
    );
  if (!generators.length) throw new Error("舞台没有连接本地生成线路");
  const ordered: typeof generators = [],
    visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const e of snapshot.edges.filter((e) => e.target === id))
      visit(e.source);
    const node = generators.find((n) => n.id === id);
    if (node) ordered.push(node);
  };
  visit(stageId);
  for (let i = 0; i < ordered.length; i++) {
    if (!stillCurrent())
      throw new Error("作品已切换，已停止后续生成；已完成文件保留");
    const node = ordered[i],
      parameters: Record<string, unknown> = { ...node.data.params },
      inputs: Record<string, string> = {};
    if (parameters.resolution)
      parameters.resolution = Number(parameters.resolution);
    if (node.type === "local_image") parameters.mode = "text-to-image";
    for (const e of snapshot.edges.filter((e) => e.target === node.id)) {
      const src = snapshot.nodes.find((n) => n.id === e.source),
        url = String(src?.data.params.result_url || src?.data.params.url || "");
      if (!url)
        throw new Error("上游素材没有完成：" + (src?.data.label || e.source));
      inputs[
        e.targetHandle ||
          (["local_music", "local_stems"].includes(node.type)
            ? "audio"
            : "image")
      ] = url;
    }
    progress({
      busy: true,
      message: `${i + 1} / ${ordered.length} · ${node.data.label}`,
    });
    const queued = await api<LocalJob>("/local-ai/generate", {
      profile_id: localNodeProfile(node.type, node.data.params),
      parameters,
      inputs,
      metadata: {
        root_project_id: rootId,
        path,
        node_id: node.id,
        origin: "performance-workflow",
      },
    });
    patch(node.id, { job_id: queued.id, job_status: queued.status });
    let job = queued;
    const began = Date.now();
    while (Date.now() - began < 3600000) {
      job = await api<LocalJob>("/local-ai/jobs/" + queued.id);
      progress({
        busy: true,
        message: `${i + 1} / ${ordered.length} · ${node.data.label} · ${job.message}`,
        jobId: queued.id,
      });
      if (
        ["succeeded", "failed", "cancelled", "interrupted"].includes(job.status)
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 1800));
    }
    const result = localResult(job);
    patch(node.id, result);
    Object.assign(node.data.params, result);
    if (job.status !== "succeeded")
      throw new Error(job.message || "本地生成未完成");
  }
  progress({
    busy: false,
    message: "四步素材已生成。点击启用音频并演出，同步播放四轨点云。",
  });
}
