/**
 * The dependency map must never make a 500-node graph compete with input.
 * This worker owns only coordinates; the deterministic graph projection stays
 * pure in @flowmap/visual-model.
 */

type LayoutRequest = {
  readonly nodes: readonly string[];
  readonly edges: readonly { readonly sourceId: string; readonly targetId: string }[];
};

type Position = { readonly id: string; readonly column: number; readonly row: number };

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const { nodes, edges } = event.data;
  const layer = new Map(nodes.map((id) => [id, 0]));
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const source = layer.get(edge.sourceId) ?? 0;
      const target = Math.max(layer.get(edge.targetId) ?? 0, source + 1);
      if (target !== layer.get(edge.targetId)) {
        layer.set(edge.targetId, target);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const rowsByLayer = new Map<number, number>();
  const positions: Position[] = [...nodes]
    .sort((a, b) => a.localeCompare(b))
    .map((id) => {
      const column = layer.get(id) ?? 0;
      const row = rowsByLayer.get(column) ?? 0;
      rowsByLayer.set(column, row + 1);
      return { id, column: column + 1, row: row + 1 };
    });
  self.postMessage(positions);
};
