import type { Params, Project } from "./types";

export type PendingLocalJob = {
  rootId: string;
  path: string[];
  nodeId: string;
  jobId: string;
};
export function pendingLocalJobs(root: Project): PendingLocalJob[] {
  const result: PendingLocalJob[] = [],
    stack = [{ graph: root, path: [] as string[] }];
  while (stack.length) {
    const { graph, path } = stack.pop()!;
    for (const node of graph.nodes) {
      if (node.data.graph)
        stack.push({ graph: node.data.graph, path: [...path, node.id] });
      const jobId = String(node.data.params.job_id || "");
      if (
        jobId &&
        ["local_", "comfy_"].some((prefix) => node.type.startsWith(prefix)) &&
        !["succeeded", "failed", "cancelled", "interrupted"].includes(
          String(node.data.params.job_status),
        )
      )
        result.push({ rootId: root.id, path, nodeId: node.id, jobId });
    }
  }
  return result;
}

export function patchLocalResult(
  root: Project,
  job: PendingLocalJob,
  params: Params,
): Project {
  if (root.id !== job.rootId) return root;
  const change = (graph: Project, depth: number): Project => {
    let changed = false;
    const nodes = graph.nodes.map((node) => {
      if (depth < job.path.length) {
        if (node.id !== job.path[depth] || !node.data.graph) return node;
        const child = change(node.data.graph, depth + 1);
        if (child === node.data.graph) return node;
        changed = true;
        return { ...node, data: { ...node.data, graph: child } };
      }
      if (
        node.id !== job.nodeId ||
        String(node.data.params.job_id) !== job.jobId
      )
        return node;
      changed = true;
      return {
        ...node,
        data: { ...node.data, params: { ...node.data.params, ...params } },
      };
    });
    return changed ? { ...graph, nodes } : graph;
  };
  return change(root, 0);
}
