// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, describe, it, expect, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────
const deleteMcp = vi.fn();
const fetchMcpDetail = vi.fn();
const trackMcpView = vi.fn();

vi.mock("../../api/mcpService", () => ({
  deleteMcp: (...a: unknown[]) => deleteMcp(...a),
  fetchMcpDetail: (...a: unknown[]) => fetchMcpDetail(...a),
  trackMcpView: (...a: unknown[]) => trackMcpView(...a),
}));
vi.mock("../../api/quickStartTemplates", () => ({
  buildQuickStartTabs: () => [
    { key: "prompt", labelKey: "prompt", content: "x" },
  ],
  TOKEN_PLACEHOLDER_RE: /<把这里换成你的 [^>]+>/g,
}));
vi.mock("../../utils/icon", () => ({ IconGlyph: () => null }));
vi.mock("@douyinfe/semi-ui", () => ({
  Toast: { success: vi.fn(), error: vi.fn() },
  Spin: () => null,
}));
// WKModal renders footer + children inline; WKButton is a plain button.
// wkConfirm is intentionally a throwing stub — if the component still called
// it (the old modal-on-modal path), the test would blow up.
vi.mock("@octo/base", () => ({
  t: (k: string) => k,
  WKModal: ({
    footer,
    children,
  }: {
    footer: React.ReactNode;
    children: React.ReactNode;
  }) =>
    React.createElement(
      "div",
      { "data-testid": "wkmodal" },
      children,
      React.createElement("div", { "data-testid": "footer" }, footer)
    ),
  WKButton: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => React.createElement("button", { onClick, disabled }, children),
  wkConfirm: () => {
    throw new Error(
      "wkConfirm should NOT be called after 方案A (no modal-on-modal)"
    );
  },
}));

import McpDetailModal from "../McpDetailModal";

let container: HTMLDivElement | null = null;
afterEach(() => {
  if (container) {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
    container = null;
  }
  vi.clearAllMocks();
});

function render(el: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    ReactDOM.render(el, container);
  });
  return container;
}

function clickButtonByText(root: HTMLElement, text: string) {
  const btn = Array.from(root.querySelectorAll("button")).find(
    (b) => b.textContent === text
  );
  if (!btn) throw new Error(`button not found: ${text}`);
  act(() => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("McpDetailModal 就地内联删除确认（方案A）", () => {
  it("详情成功后每次打开仅上报一次查看", async () => {
    fetchMcpDetail.mockResolvedValue({
      id: "m1",
      name: "MCP",
      slogan: "",
      category: "dev",
      icon: "",
      tags: [],
      toolCount: 0,
      viewCount: 12,
      quickStart: { transport: "streamable-http", serverName: "MCP" },
      tools: [],
      usageExamples: [],
      faqs: [],
      notes: [],
    });
    trackMcpView.mockRejectedValue(new Error("metrics unavailable"));

    let root!: HTMLElement;
    await act(async () => {
      root = render(React.createElement(McpDetailModal, { mcpId: "m1", onClose: vi.fn() }));
      await Promise.resolve();
    });
    expect(root.textContent).toContain("12");
    expect(trackMcpView).toHaveBeenCalledTimes(1);
    expect(trackMcpView).toHaveBeenCalledWith("m1");

    act(() => {
      ReactDOM.unmountComponentAtNode(root);
    });
    root.remove();
    container = null;
    await act(async () => {
      render(React.createElement(McpDetailModal, { mcpId: "m1", onClose: vi.fn() }));
      await Promise.resolve();
    });
    expect(trackMcpView).toHaveBeenCalledTimes(2);
  });

  it("详情请求失败或已取消时不上报查看", async () => {
    fetchMcpDetail.mockRejectedValueOnce(new Error("load failed"));
    await act(async () => {
      render(React.createElement(McpDetailModal, { mcpId: "failed", onClose: vi.fn() }));
      await Promise.resolve();
    });
    expect(trackMcpView).not.toHaveBeenCalled();

    let resolveDetail!: (value: unknown) => void;
    fetchMcpDetail.mockReturnValueOnce(new Promise((resolve) => {
      resolveDetail = resolve;
    }));
    const root = render(React.createElement(McpDetailModal, { mcpId: "cancelled", onClose: vi.fn() }));
    act(() => {
      ReactDOM.unmountComponentAtNode(root);
    });
    root.remove();
    container = null;
    await act(async () => {
      resolveDetail({
        id: "cancelled", name: "MCP", slogan: "", category: "dev", icon: "", tags: [], toolCount: 0, viewCount: 1,
        quickStart: { transport: "streamable-http", serverName: "MCP" }, tools: [], usageExamples: [], faqs: [], notes: [],
      });
      await Promise.resolve();
    });
    expect(trackMcpView).not.toHaveBeenCalled();
  });

  it("点删除→footer 就地切确认态，不弹新窗；确认→调用 deleteMcp", async () => {
    fetchMcpDetail.mockResolvedValue({
      id: "m1",
      name: "测试666",
      slogan: "",
      category: "dev",
      icon: "",
      tags: [],
      toolCount: 0,
      viewCount: 12,
      visibility: "private",
      creatorName: "dev",
      quickStart: { transport: "streamable-http", serverName: "测试666" },
      tools: [],
      usageExamples: [],
      faqs: [],
      notes: [],
      createdAt: "",
      updatedAt: "",
    });
    deleteMcp.mockResolvedValue(undefined);

    const onDeleted = vi.fn();
    const onClose = vi.fn();
    let root!: HTMLElement;
    await act(async () => {
      root = render(
        React.createElement(McpDetailModal, {
          mcpId: "m1",
          onClose,
          canManage: true,
          onEdit: vi.fn(),
          onDeleted,
        })
      );
      await Promise.resolve();
    });

    // 初始态：有「删除」和「编辑」两个按钮
    const initialBtns = Array.from(root.querySelectorAll("button")).map(
      (b) => b.textContent
    );
    expect(initialBtns).toContain("mcp.detail.delete");
    expect(initialBtns).toContain("mcp.detail.edit");

    // 点「删除」——footer 就地切成确认态；应出现确认提示文案 + 确认删除按钮，
    // 且没有第二个 WKModal（不叠遮罩）。wkConfirm 抛错的 stub 也未触发。
    clickButtonByText(root, "mcp.detail.delete");
    expect(root.querySelectorAll('[data-testid="wkmodal"]').length).toBe(1);
    expect(root.textContent).toContain("mcp.delete.confirmBody");
    const confirmBtns = Array.from(root.querySelectorAll("button")).map(
      (b) => b.textContent
    );
    expect(confirmBtns).toContain("mcp.delete.ok");
    expect(confirmBtns).toContain("mcp.delete.cancel");

    // 点「确认删除」——发起真正的删除
    await act(async () => {
      clickButtonByText(root, "mcp.delete.ok");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(deleteMcp).toHaveBeenCalledWith("m1");
    expect(onDeleted).toHaveBeenCalledWith("m1");
    expect(onClose).toHaveBeenCalled();
  });
});
