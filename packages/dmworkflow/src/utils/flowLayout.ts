// Layered layout for ExecutionView: arranges nodes left-to-right by topological
// depth so same-layer (parallel) nodes render side-by-side, and emits dashed
// "sibling" edges between nodes that share a layer + at least one upstream
// parent — which is the precise definition of "parallel" in our DAG.
//
// Pure utility, no React. Heavy logic kept here so FlowEditor stays
// rendering-focused.

import type { FlowDefinition, FlowEdge, FlowNode } from "../types/flow";

const COLUMN_X = 240;
const ROW_Y = 110;
const ORIGIN_X = 80;
const ORIGIN_Y = 40;

export const PARALLEL_EDGE_PREFIX = "__parallel__";

/** Returns true if the synthetic edge id was emitted by buildLayeredLayout. */
export function isParallelSiblingEdge(edgeId: string): boolean {
  return edgeId.startsWith(PARALLEL_EDGE_PREFIX);
}

interface LayoutResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** node-id → 0-based layer index. Useful for tests & debugging. */
  layers: Record<string, number>;
}

/**
 * Compute layered positions and synthetic sibling edges for a flow definition.
 * The original `position` of each node is replaced; original edges are
 * preserved verbatim.
 */
export function buildLayeredLayout(def: FlowDefinition): LayoutResult {
  const nodes = def.nodes;
  const edges = def.edges;
  if (nodes.length === 0) {
    return { nodes: [], edges: [], layers: {} };
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adjOut = new Map<string, string[]>();
  const adjIn = new Map<string, string[]>();
  for (const n of nodes) {
    adjOut.set(n.id, []);
    adjIn.set(n.id, []);
  }
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    adjOut.get(e.source)!.push(e.target);
    adjIn.get(e.target)!.push(e.source);
  }

  // Layer assignment: a node sits one layer past its deepest predecessor.
  // Cycles are tolerated (we cap iterations); any node we can't reach gets
  // layer 0 so it still renders.
  const layer: Record<string, number> = {};
  const seedRoots: string[] = nodes.filter((n) => (adjIn.get(n.id) ?? []).length === 0).map((n) => n.id);
  const queue: string[] = [];
  for (const id of seedRoots) {
    layer[id] = 0;
    queue.push(id);
  }
  // Fallback: if the graph has no source (every node in a cycle), seed all
  // nodes at layer 0.
  if (queue.length === 0) {
    for (const n of nodes) {
      layer[n.id] = 0;
      queue.push(n.id);
    }
  }
  const safetyLimit = nodes.length * 8;
  let iterations = 0;
  while (queue.length > 0 && iterations < safetyLimit) {
    iterations += 1;
    const cur = queue.shift()!;
    const curLayer = layer[cur] ?? 0;
    for (const next of adjOut.get(cur) ?? []) {
      const nextLayer = curLayer + 1;
      if (layer[next] === undefined || layer[next] < nextLayer) {
        layer[next] = nextLayer;
        queue.push(next);
      }
    }
  }
  for (const n of nodes) {
    if (layer[n.id] === undefined) layer[n.id] = 0;
  }

  // Group by layer and assign deterministic vertical slots. Sort within a
  // layer by (parent layer-row, then original id) so a parent's children stay
  // visually close to it.
  const layerToIds = new Map<number, string[]>();
  for (const n of nodes) {
    const l = layer[n.id];
    if (!layerToIds.has(l)) layerToIds.set(l, []);
    layerToIds.get(l)!.push(n.id);
  }
  const sortedLayers = Array.from(layerToIds.keys()).sort((a, b) => a - b);
  const slot: Record<string, number> = {};
  for (const l of sortedLayers) {
    const ids = layerToIds.get(l)!;
    ids.sort((a, b) => {
      const pa = (adjIn.get(a) ?? [])[0];
      const pb = (adjIn.get(b) ?? [])[0];
      const sa = pa !== undefined ? slot[pa] ?? 0 : 0;
      const sb = pb !== undefined ? slot[pb] ?? 0 : 0;
      if (sa !== sb) return sa - sb;
      return a.localeCompare(b);
    });
    ids.forEach((id, idx) => {
      slot[id] = idx;
    });
  }

  const positionedNodes: FlowNode[] = nodes.map((n) => ({
    ...n,
    position: {
      x: ORIGIN_X + (layer[n.id] ?? 0) * COLUMN_X,
      y: ORIGIN_Y + (slot[n.id] ?? 0) * ROW_Y,
    },
  }));

  // Sibling/parallel edges: two nodes are "parallel siblings" when they sit
  // on the same layer AND share at least one upstream parent. We connect
  // adjacent ones (ordered by slot) with a dashed edge so the layered
  // relationship is visually obvious in the read-only view.
  const siblingEdges: FlowEdge[] = [];
  for (const l of sortedLayers) {
    if (l === 0) continue;
    const ids = layerToIds.get(l)!;
    if (ids.length < 2) continue;
    for (let i = 0; i + 1 < ids.length; i += 1) {
      const a = ids[i];
      const b = ids[i + 1];
      const parentsA = new Set(adjIn.get(a) ?? []);
      const parentsB = adjIn.get(b) ?? [];
      const sharesParent = parentsB.some((p) => parentsA.has(p));
      if (!sharesParent) continue;
      siblingEdges.push({
        id: `${PARALLEL_EDGE_PREFIX}${a}__${b}`,
        source: a,
        target: b,
      });
    }
  }

  return {
    nodes: positionedNodes,
    edges: [...edges, ...siblingEdges],
    layers: layer,
  };
}
