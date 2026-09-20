import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DocumentSelector from ".";

vi.mock("@douyinfe/semi-ui", () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
  Checkbox: ({ checked, disabled }: any) => (
    <input type="checkbox" checked={checked} disabled={disabled} readOnly />
  ),
  Input: ({ value, onChange, ...props }: any) => (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      {...props}
    />
  ),
  Modal: ({ visible, children }: any) =>
    visible ? <div>{children}</div> : null,
  Spin: () => <span>loading</span>,
}));

const item = {
  docId: "doc-1",
  title: "项目复盘",
  docType: "doc" as const,
  updatedAt: 1,
};

describe("DocumentSelector", () => {
  it("toggles a document and allows confirming an empty selection", () => {
    const onToggle = vi.fn();
    const onConfirm = vi.fn();
    const onLoadMore = vi.fn();
    render(
      <DocumentSelector
        visible
        state={{
          source: "recent",
          keyword: "项目",
          items: [item],
          selected: [],
          isLoading: false,
          error: null,
          maxSelect: 10,
          hasMore: true,
        }}
        actions={{
          onSourceChange: vi.fn(),
          onKeywordChange: vi.fn(),
          onToggle,
          onRetry: vi.fn(),
          onLoadMore,
          onConfirm,
          onCancel: vi.fn(),
        }}
      />
    );

    fireEvent.click(screen.getByText("项目复盘"));
    expect(onToggle).toHaveBeenCalledWith(item);
    const confirm = screen.getByTestId("summary-document-selector-confirm-btn");
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("仅支持文档和 HTML，不含表格及白板")
    ).toBeInTheDocument();
    const recentTab = screen.getByRole("tab", { name: "最近查看" });
    const results = screen.getByRole("tabpanel");
    expect(recentTab).toHaveAttribute("aria-controls", results.id);
    expect(results).toHaveAttribute("aria-labelledby", recentTab.id);
  });

  it("retains rows during loading and provides a retry for the failed next page", () => {
    const props = {
      visible: true,
      state: {
        source: "mine" as const,
        keyword: "",
        items: [item],
        selected: [item],
        isLoading: false,
        error: null,
        maxSelect: 10,
        hasMore: true,
        isLoadingMore: true,
      },
      actions: {
        onSourceChange: vi.fn(),
        onKeywordChange: vi.fn(),
        onToggle: vi.fn(),
        onRetry: vi.fn(),
        onLoadMore: vi.fn(),
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      },
    };
    const { rerender } = render(<DocumentSelector {...props} />);
    expect(screen.getByText(item.title)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "正在加载文档…" })
    ).toBeDisabled();
    rerender(
      <DocumentSelector
        {...props}
        state={{
          ...props.state,
          isLoadingMore: false,
          loadMoreError: "分页失败",
        }}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("分页失败");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(props.actions.onLoadMore).toHaveBeenCalledTimes(1);
    expect(props.actions.onRetry).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox")).toBeChecked();
    rerender(
      <DocumentSelector {...props} state={{ ...props.state, hasMore: false }} />
    );
    expect(
      screen.queryByRole("button", { name: "加载更多" })
    ).not.toBeInTheDocument();
  });
});
