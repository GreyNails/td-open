import { describe, it, expect } from "vitest";
import { pendingLocalJobs, patchLocalResult } from "./localAIResults";
import type { Project } from "./types";
const project = (): Project => ({
  id: "root",
  name: "Scoped result",
  version: 1,
  nodes: [
    {
      id: "component",
      type: "base_comp",
      position: { x: 0, y: 0 },
      data: {
        label: "Nested",
        params: {},
        graph: {
          id: "inner",
          name: "Inner",
          version: 1,
          nodes: [
            {
              id: "generation",
              type: "local_image",
              position: { x: 12, y: 34 },
              data: {
                label: "Image",
                params: {
                  job_id: "old_job",
                  job_status: "queued",
                  prompt: "original",
                },
              },
            },
          ],
          edges: [],
        },
      },
    },
  ],
  edges: [],
});
describe("asynchronous local results", () => {
  it("finds pending jobs inside real component scopes", () => {
    expect(pendingLocalJobs(project())).toEqual([
      {
        rootId: "root",
        path: ["component"],
        nodeId: "generation",
        jobId: "old_job",
      },
    ]);
  });
  it("applies only the matching job while retaining edits made during generation", () => {
    const root = project(),
      job = pendingLocalJobs(root)[0];
    root.nodes[0].data.graph!.nodes[0].data.params.prompt =
      "edited while running";
    const updated = patchLocalResult(root, job, {
      result_url: "/api/assets/result.png",
      job_status: "succeeded",
    });
    const node = updated.nodes[0].data.graph!.nodes[0];
    expect(node.data.params.prompt).toBe("edited while running");
    expect(node.position).toEqual({ x: 12, y: 34 });
    expect(node.data.params.result_url).toBe("/api/assets/result.png");
    expect(pendingLocalJobs(updated)).toEqual([]);
    expect(
      root.nodes[0].data.graph!.nodes[0].data.params.result_url,
    ).toBeUndefined();
  });
  it("rejects a stale result after a replacement job or project switch", () => {
    const root = project(),
      job = pendingLocalJobs(root)[0];
    root.nodes[0].data.graph!.nodes[0].data.params.job_id = "new_job";
    expect(patchLocalResult(root, job, { result_url: "old.png" })).toBe(root);
    expect(
      patchLocalResult({ ...root, id: "another" }, job, {
        result_url: "old.png",
      }).nodes[0].data.graph!.nodes[0].data.params.result_url,
    ).toBeUndefined();
  });
  it("does not restore a deleted target or removed component", () => {
    const root = project(),
      job = pendingLocalJobs(root)[0];
    root.nodes = [];
    expect(patchLocalResult(root, job, { result_url: "old.png" })).toBe(root);
  });
});
