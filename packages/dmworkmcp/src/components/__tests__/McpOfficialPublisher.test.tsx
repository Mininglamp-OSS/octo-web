// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import McpCard from "../McpCard";
import McpDetailModal from "../McpDetailModal";
import type { McpDetail, McpListItem } from "../../types/mcp";

const fetchMcpDetail = vi.fn();

vi.mock("../../api/mcpService", () => ({
  deleteMcp: vi.fn(),
  fetchMcpDetail: (...args: unknown[]) => fetchMcpDetail(...args),
}));
vi.mock("../../api/quickStartTemplates", () => ({
  buildQuickStartTabs: () => [],
  TOKEN_PLACEHOLDER_RE: /$^/g,
}));
vi.mock("../../utils/icon", () => ({ IconGlyph: () => null }));
vi.mock("@douyinfe/semi-ui", () => ({
  Spin: () => null,
  Toast: { success: vi.fn(), error: vi.fn() },
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@octo/base", () => ({
  t: (key: string) => (key === "mcp.card.officialPublisher" ? "官方发布" : key),
  WKButton: ({ children }: { children: React.ReactNode }) =>
    React.createElement("button", null, children),
  WKModal: ({
    children,
    header,
  }: {
    children: React.ReactNode;
    header?: React.ReactNode;
  }) => React.createElement("div", null, header, children),
  wkConfirm: vi.fn(),
}));

let container: HTMLDivElement | null = null;

afterEach(() => {
  if (container) {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
    container = null;
  }
  vi.clearAllMocks();
});

function render(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    ReactDOM.render(element, container);
  });
  return container;
}

const baseItem: McpListItem = {
  id: "mcp-1",
  name: "Official MCP",
  slogan: "Test MCP",
  category: "dev",
  tags: [],
  toolCount: 1,
  icon: "",
  visibility: "system",
  source: "system",
  creatorName: "Internal Admin",
  matchReasons: ["creator:Internal Admin", "tool:search"],
};

describe("official MCP publisher", () => {
  it("shows official publisher on cards without leaking creator identity", () => {
    const root = render(<McpCard item={baseItem} onClick={vi.fn()} />);

    expect(root.querySelector(".wk-mcp-card--official")).not.toBeNull();
    expect(root.textContent).toContain("官方发布");
    expect(root.textContent).not.toContain("Internal Admin");
    expect(root.textContent).toContain("search");
  });

  it("keeps normal publisher rendering for non-system MCPs", () => {
    const root = render(
      <McpCard
        item={{ ...baseItem, visibility: "public", source: "system" }}
        onClick={vi.fn()}
      />
    );

    expect(root.querySelector(".wk-mcp-card--official")).toBeNull();
    expect(root.textContent).toContain("Internal Admin");
    expect(root.textContent).not.toContain("官方发布");
  });

  it("keeps card keyboard activation for official MCPs", () => {
    const onClick = vi.fn();
    const root = render(<McpCard item={baseItem} onClick={onClick} />);
    const card = root.querySelector(".wk-mcp-card") as HTMLElement;

    act(() => {
      card.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      );
    });

    expect(onClick).toHaveBeenCalledWith(baseItem);
  });

  it("shows the same official publisher in details", async () => {
    const detail: McpDetail = {
      ...baseItem,
      quickStart: { transport: "streamable-http", serverName: "Official MCP" },
      tools: [],
      usageExamples: [],
      faqs: [],
      notes: [],
    };
    fetchMcpDetail.mockResolvedValue(detail);

    let root!: HTMLElement;
    await act(async () => {
      root = render(<McpDetailModal mcpId="mcp-1" onClose={vi.fn()} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(root.textContent).toContain("官方发布");
    expect(root.textContent).not.toContain("Internal Admin");
  });
});
