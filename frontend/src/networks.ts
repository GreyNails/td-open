import type { GraphEdge, GraphNode, Project } from "./types";

export const networkTypes = new Set([
  "base_comp",
  "engine_comp",
  "container_comp",
  "widget_comp",
  "time_comp",
  "replicator_comp",
]);
export function graphAt(root: Project, path: string[]): Project {
  let graph = root;
  for (const id of path) {
    const next = graph.nodes.find((n) => n.id === id)?.data.graph;
    if (!next) throw new Error(`组件网络不存在：${id}`);
    graph = next;
  }
  return graph;
}
export function updateGraph(
  root: Project,
  path: string[],
  update: (p: Project) => Project,
): Project {
  if (!path.length) return update(root);
  const [id, ...tail] = path;
  if (!root.nodes.some((n) => n.id === id && n.data.graph))
    throw new Error(`组件网络不存在：${id}`);
  return {
    ...root,
    nodes: root.nodes.map((n) =>
      n.id !== id
        ? n
        : {
            ...n,
            data: {
              ...n.data,
              graph: updateGraph(n.data.graph!, tail, update),
            },
          },
    ),
  };
}
export function emptyNetwork(id: string): Project {
  return {
    id: `net_${id}`.slice(0, 96),
    name: "内部网络",
    version: 1,
    nodes: [],
    edges: [],
  };
}
export function operatorPath(scope: string, path: string): string {
  const parts = (path.startsWith("/") ? path : scope + path).split("/");
  const result: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      if (/^_copy\d+$/.test(result.at(-1) || "")) result.pop();
      result.pop();
    } else if (part && part !== ".") result.push(part);
  }
  return result.join("/");
}
/** Compile nested ports to a flat cook graph; stored projects retain their hierarchy. */
export function compileNetworks(root: Project): Project {
  const nodes: GraphNode[] = [],
    edges: GraphEdge[] = [];
  const outputs = new Map<string, string>();
  const walk = (
    graph: Project,
    prefix: string,
    parentInputs: GraphEdge[],
    depth: number,
    clocks: Record<string, unknown>[] = [],
    replica = 0,
  ) => {
    if (depth > 16) throw new Error("组件嵌套最多 16 层");
    for (const original of graph.nodes) {
      const id = prefix + original.id;
      const params = { ...original.data.params };
      delete params.__td_clocks;
      delete params.__td_replica;
      nodes.push({
        ...original,
        id,
        data: {
          ...original.data,
          params: {
            ...params,
            ...(clocks.length ? { __td_clocks: JSON.stringify(clocks) } : {}),
            __td_replica: replica,
          },
        },
      });
      if (nodes.length > 5000) throw new Error("项目总节点数不能超过 5000");
      if (/^network_in_/.test(original.type) && prefix) {
        const index = Math.max(1, Number(original.data.params.index || 1));
        const edge = parentInputs.find(
          (e) =>
            (e.targetHandle || "in") === (index === 1 ? "in" : `in${index}`),
        );
        if (edge)
          edges.push({
            ...edge,
            id: `${id}/input`,
            target: id,
            targetHandle: "in",
          });
      }
      if (original.data.graph) {
        const seenOutputs = new Set<number>();
        for (const out of original.data.graph.nodes.filter((n) =>
          /^network_out_/.test(n.type),
        )) {
          const index = Math.max(1, Number(out.data.params.index || 1));
          if (seenOutputs.has(index))
            throw new Error(`组件 ${id} 的输出编号 ${index} 重复`);
          seenOutputs.add(index);
        }
        const inputs = graph.edges
          .filter((e) => e.target === original.id)
          .map((e) => ({ ...e, source: prefix + e.source }));
        const childClocks =
          original.type === "time_comp"
            ? [
                ...clocks,
                {
                  rate: original.data.params.rate ?? 1,
                  offset: original.data.params.offset ?? 0,
                  loop: original.data.params.loop ?? false,
                  duration: original.data.params.duration ?? 10,
                },
              ]
            : clocks;
        walk(
          original.data.graph,
          id + "/",
          inputs,
          depth + 1,
          childClocks,
          original.type === "replicator_comp" ? 0 : replica,
        );
        if (original.type === "replicator_comp") {
          const count = Math.max(
            1,
            Math.min(16, Math.floor(Number(original.data.params.count) || 4)),
          );
          const first = original.data.graph.nodes.find(
            (n) =>
              n.type === "network_out_top" &&
              Number(n.data.params.index || 1) === 1,
          );
          if (first)
            edges.push({
              id: id + "/copy0",
              source: id + "/" + first.id,
              target: id,
              targetHandle: "copy_0",
            });
          for (let i = 1; i < count; i++) {
            const copyPrefix = id + "/_copy" + i + "/";
            walk(
              original.data.graph,
              copyPrefix,
              inputs,
              depth + 1,
              childClocks,
              i,
            );
            if (first)
              edges.push({
                id: id + "/copy" + i,
                source: copyPrefix + first.id,
                target: id,
                targetHandle: "copy_" + i,
              });
          }
          continue;
        }
        const outNodes = original.data.graph.nodes.filter((n) =>
          /^network_out_/.test(n.type),
        );
        for (const out of outNodes) {
          const index = Math.max(1, Number(out.data.params.index || 1));
          const handle = index === 1 ? "out" : `out${index}`;
          if (outputs.has(id + ":" + handle))
            throw new Error(`组件 ${id} 的输出编号 ${index} 重复`);
          outputs.set(id + ":" + handle, id + "/" + out.id);
        }
        const first = outNodes.find(
          (n) => Number(n.data.params.index || 1) === 1,
        );
        if (first)
          edges.push({
            id: id + "/result",
            source: id + "/" + first.id,
            target: id,
            targetHandle: "internal",
          });
      }
      if (
        /^operator_select_/.test(original.type) &&
        original.data.params.path
      ) {
        edges.push({
          id: id + "/reference",
          source: operatorPath(prefix, String(original.data.params.path)),
          target: id,
          targetHandle: "in",
        });
      }
      const referenceParam =
        original.type === "ref_top_op_viewer"
          ? "source"
          : original.type === "ref_top_import_select"
            ? "parent"
            : undefined;
      if (referenceParam && original.data.params[referenceParam]) {
        edges.push({
          id: id + "/reference",
          source: operatorPath(
            prefix,
            String(original.data.params[referenceParam]),
          ),
          target: id,
          targetHandle: "reference",
        });
      }
    }
    edges.push(
      ...graph.edges.map((e) => ({
        ...e,
        id: prefix + e.id,
        source: prefix + e.source,
        target: prefix + e.target,
      })),
    );
  };
  walk(root, "", [], 0);
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const edge of edges) {
    const route = outputs.get(edge.source + ":" + (edge.sourceHandle || "out"));
    if (route) {
      edge.source = route;
      edge.sourceHandle = "out";
    }
    if (!nodeIds.has(edge.source))
      throw new Error(`引用的节点不存在：/${edge.source}`);
  }
  return { ...root, nodes, edges };
}

export function networkTime(
  globalTime: number,
  params: GraphNode["data"]["params"],
): number {
  let time = globalTime;
  for (const clock of JSON.parse(String(params.__td_clocks || "[]")).slice(
    0,
    16,
  )) {
    time = time * Number(clock.rate ?? 1) + Number(clock.offset ?? 0);
    if (clock.loop) {
      const duration = Math.max(0.001, Number(clock.duration || 10));
      time = ((time % duration) + duration) % duration;
    }
  }
  if (!Number.isFinite(time)) throw new Error("组件时钟必须产生有限时间");
  return time;
}
