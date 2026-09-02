// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, describe, it, expect, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────
const deleteMcp = vi.fn();
const fetchMcpDetail = vi.fn();

vi.mock("../../api/mcpService", () => ({
  deleteMcp: (...a: unknown[]) => deleteMcp(...a),
  fetchMcpDetail: (...a: unknown[]) => fetchMcpDetail(...a),
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
// Octo Modal renders footer + children inline.
// modalConfirm is intentionally a throwing stub — if the component still called
// it (the old modal-on-modal path), the test would blow up.
vi.mock("@octo/ui", () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
  }) => React.createElement("button", { disabled, onClick }, children),
  Modal: ({
    children,
    footer,
    header,
    title,
    visible = true,
  }: {
    children: React.ReactNode;
    footer?: React.ReactNode;
    header?: React.ReactNode;
    title?: React.ReactNode;
    visible?: boolean;
  }) =>
    visible
      ? React.createElement(
          "div",
          { "data-testid": "octo-modal" },
          header ?? title,
          children,
          React.createElement("div", { "data-testid": "footer" }, footer)
        )
      : null,
  modalConfirm: () => {
    throw new Error(
      "modalConfirm should NOT be called after 方案A (no modal-on-modal)"
    );
  },
}));
vi.mock("@octo/base", () => ({
  t: (k: string) => k,
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
  return document.body;
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
  it("点删除→footer 就地切确认态，不弹新窗；确认→调用 deleteMcp", async () => {
    fetchMcpDetail.mockResolvedValue({
      id: "m1",
      name: "测试666",
      slogan: "",
      category: "dev",
      icon: "",
      tags: [],
      toolCount: 0,
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
    // 且没有第二个 OctoModal（不叠遮罩）。modalConfirm 抛错的 stub 也未触发。
    clickButtonByText(root, "mcp.detail.delete");
    expect(root.querySelectorAll('[data-testid="octo-modal"]').length).toBe(1);
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
