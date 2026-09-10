import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NativeFormalVersionPanel from "./NativeFormalVersionPanel";
import { formalContentFixture } from "../../__tests__/formalContentFixtures";

vi.mock("@octo/base", async (original) => ({
  ...await original<typeof import("@octo/base")>(),
  WKButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));
const content = formalContentFixture();
const prior = { ...content.current_version!, version_id: "opaque-history-id", version: 0, is_current: false };
const actions = () => ({ onClose: vi.fn(), onSelect: vi.fn(), onMore: vi.fn(), onRestore: vi.fn().mockResolvedValue(true), onApply: vi.fn().mockResolvedValue(true) });

describe("native formal version sidebar", () => {
  it("uses the existing sidebar and requires confirmation before restoring an opaque version", () => {
    const callbacks = actions();
    const { container } = render(<NativeFormalVersionPanel content={content} versions={[prior]}
      selected={prior} pending={false} hasMore actions={callbacks} />);
    expect(container.querySelector(".version-panel .version-card")).toBeTruthy();
    expect(screen.getByRole("button", { name: "恢复此版本" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "恢复此版本" }));
    expect(callbacks.onRestore).toHaveBeenCalledWith("opaque-history-id");
    fireEvent.click(screen.getByRole("button", { name: "加载更多版本" }));
    expect(callbacks.onMore).toHaveBeenCalled();
  });
  it("gates candidate application while a new run owns the content", () => {
    const candidate = { ...prior, pending_application: true, generation_id: "opaque-run" };
    const callbacks = actions();
    render(<NativeFormalVersionPanel content={{ ...content, capabilities: { ...content.capabilities, can_edit: false } }}
      versions={[candidate]} selected={candidate} pending={false} hasMore={false} actions={callbacks} />);
    expect(screen.getByRole("button", { name: "应用此版本" })).toBeDisabled();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
