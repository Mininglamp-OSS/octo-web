import { describe, expect, it } from "vitest";
import { buildLayeredLayout, isParallelSiblingEdge } from "../flowLayout";
import type { FlowDefinition } from "../../types/flow";

const action = (id: string) => ({
  id,
  type: "action.script" as const,
  position: { x: 0, y: 0 },
  config: {},
});

describe("buildLayeredLayout", () => {
  it("returns empty result for empty definition", () => {
    const out = buildLayeredLayout({ nodes: [], edges: [] });
    expect(out.nodes).toEqual([]);
    expect(out.edges).toEqual([]);
  });

  it("places same-layer parallel siblings in different rows and emits a dashed edge", () => {
    const def: FlowDefinition = {
      nodes: [
        { ...action("t"), type: "trigger.manual" },
        action("a"),
        action("b"),
      ],
      edges: [
        { id: "e1", source: "t", target: "a" },
        { id: "e2", source: "t", target: "b" },
      ],
    };
    const out = buildLayeredLayout(def);
    expect(out.layers).toEqual({ t: 0, a: 1, b: 1 });
    const a = out.nodes.find((n) => n.id === "a")!;
    const b = out.nodes.find((n) => n.id === "b")!;
    // Same column, different rows.
    expect(a.position.x).toBe(b.position.x);
    expect(a.position.y).not.toBe(b.position.y);
    const sibling = out.edges.filter((e) => isParallelSiblingEdge(e.id));
    expect(sibling).toHaveLength(1);
    expect(sibling[0]).toMatchObject({ source: "a", target: "b" });
  });

  it("does not connect same-layer nodes that don't share a parent", () => {
    const def: FlowDefinition = {
      nodes: [action("a"), action("b")],
      edges: [],
    };
    const out = buildLayeredLayout(def);
    const sibling = out.edges.filter((e) => isParallelSiblingEdge(e.id));
    expect(sibling).toHaveLength(0);
  });

  it("diamond: layer of a node = max layer of its parents + 1", () => {
    const def: FlowDefinition = {
      nodes: [
        { ...action("t"), type: "trigger.manual" },
        action("a"),
        action("b"),
        action("s"),
      ],
      edges: [
        { id: "e1", source: "t", target: "a" },
        { id: "e2", source: "t", target: "b" },
        { id: "e3", source: "a", target: "s" },
        { id: "e4", source: "b", target: "s" },
      ],
    };
    const out = buildLayeredLayout(def);
    expect(out.layers.s).toBe(2);
    expect(out.layers.a).toBe(1);
    expect(out.layers.b).toBe(1);
  });
});
