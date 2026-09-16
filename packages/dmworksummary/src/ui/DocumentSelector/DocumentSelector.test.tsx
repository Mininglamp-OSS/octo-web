import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DocumentSelector from ".";

vi.mock("@douyinfe/semi-ui", () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>{children}</button>
  ),
  Checkbox: ({ checked, disabled }: any) => (
    <input type="checkbox" checked={checked} disabled={disabled} readOnly />
  ),
  Input: ({ value, onChange, ...props }: any) => (
    <input value={value} onChange={(event) => onChange(event.target.value)} {...props} />
  ),
  Modal: ({ visible, children }: any) => visible ? <div>{children}</div> : null,
  Spin: () => <span>loading</span>,
}));

const item = {
  docId: "doc-1",
  title: "项目复盘",
  docType: "doc" as const,
  updatedAt: 1,
};

describe("DocumentSelector", () => {
  it("toggles a document and confirms the selection", () => {
    const onToggle = vi.fn();
    const onConfirm = vi.fn();
    render(
      <DocumentSelector
        visible
        state={{
          keyword: "项目",
          items: [item],
          selected: [],
          isLoading: false,
          error: null,
          maxSelect: 10,
        }}
        actions={{
          onKeywordChange: vi.fn(),
          onToggle,
          onRetry: vi.fn(),
          onConfirm,
          onCancel: vi.fn(),
        }}
      />
    );

    fireEvent.click(screen.getByText("项目复盘"));
    expect(onToggle).toHaveBeenCalledWith(item);
    expect(screen.getByTestId("summary-document-selector-confirm-btn")).toBeDisabled();
  });
});
