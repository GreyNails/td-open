import type { GraphNode, NodeSpec } from "./types";
export const nodeCardHeight = (spec: NodeSpec | undefined) =>
  148 + Math.max(spec?.inputs.length || 0, spec?.outputs.length || 0) * 22;
export function arrangeNodes(
  nodes: GraphNode[],
  specs: Record<string, NodeSpec>,
  measured: (id: string) => number | undefined = () => undefined,
) {
  const rowHeights: number[] = [];
  nodes.forEach((node, i) => {
    const row = Math.floor(i / 4);
    rowHeights[row] = Math.max(
      rowHeights[row] || 0,
      (measured(node.id) || nodeCardHeight(specs[node.type])) + 40,
    );
  });
  const offsets = rowHeights.map((_, row) =>
    rowHeights.slice(0, row).reduce((sum, height) => sum + height, 0),
  );
  return nodes.map((node, i) => ({
    ...node,
    position: { x: (i % 4) * 245, y: offsets[Math.floor(i / 4)] },
  }));
}
