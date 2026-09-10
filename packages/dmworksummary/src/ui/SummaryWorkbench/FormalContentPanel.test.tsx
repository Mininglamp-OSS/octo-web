import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FormalContentPanel, { shanghaiDateInput, type FormalContentPanelProps } from "./FormalContentPanel";
import { formalContentFixture, generationConfigurationFixture, generationFixture } from "../../__tests__/formalContentFixtures";

vi.mock("@octo/base", async (importOriginal) => {
  const original = await importOriginal<typeof import("@octo/base")>();
  return { ...original, WKButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button> };
});

function props(): FormalContentPanelProps {
  const config = generationConfigurationFixture();
  return {
    title: "Do not use this title as the requirement", content: formalContentFixture(),
    state: {
      configuration: config, draftSpec: config.spec, versions: [], hasMore: false,
      pending: false, errorKey: "", noticeKey: "", sourceLabels: ["Project"],
    },
    actions: {
      onChooseSources: vi.fn(), onDraftSpecChange: vi.fn(), onConfigure: vi.fn(), onSaveConfiguration: vi.fn().mockResolvedValue(true),
      onRefine: vi.fn().mockResolvedValue(true), onRegenerate: vi.fn(), onEdit: vi.fn().mockResolvedValue(true), onRestore: vi.fn().mockResolvedValue(true),
      onVersions: vi.fn(), onCancel: vi.fn(), onApply: vi.fn(), onReload: vi.fn(),
    },
    renderVersion: (v) => <p>{v.content}</p>,
  };
}

describe("FormalContentPanel", () => {
  it("shows absolute configuration dates in the declared Shanghai timezone", () => {
    expect(shanghaiDateInput("2026-09-08T01:00:00Z")).toBe("2026-09-08T09:00");
    expect(shanghaiDateInput("2026-09-08T09:00:00+08:00")).toBe("2026-09-08T09:00");
    expect(shanghaiDateInput("invalid")).toBe("");
  });
  it("requires scope confirmation, saves without running, and keeps the requirement empty", async () => {
    const p = props();
    render(<FormalContentPanel {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "定时更新" }));
    expect(screen.getByLabelText("生成要求（可留空，不能用标题代替）")).toHaveValue("");
    expect(screen.getByRole("button", { name: "保存配置与计划" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "确认所选聊天、时间范围及生成要求" }));
    fireEvent.click(screen.getByRole("button", { name: "保存配置与计划" }));
    await waitFor(() => expect(p.actions.onSaveConfiguration).toHaveBeenCalledWith(expect.objectContaining({
      expected_config_revision: 0, spec: expect.objectContaining({ requirement: "", sources: [{ source_id: "group1", source_type: 1, confirmation: "user_confirmed" }] }),
      schedule: expect.objectContaining({ enabled: false }),
    }), false));
  });
  it("keeps configuration saving available during a run but blocks generation and overwrites", () => {
    const p = props();
    p.content.active_generation = generationFixture();
    p.content.capabilities.can_edit = false;
    p.content.capabilities.can_refine = false;
    render(<FormalContentPanel {...p} />);
    expect(screen.getByRole("button", { name: "编辑", exact: true })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "定时更新" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "确认所选聊天、时间范围及生成要求" }));
    expect(screen.getByRole("button", { name: "保存配置与计划" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "保存并立即生成一次" })).toBeDisabled();
    expect(screen.getByText("Old summary")).toBeInTheDocument();
  });
  it("requires a separate destructive confirmation for editing", () => {
    const p = props();
    render(<FormalContentPanel {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑", exact: true }));
    expect(screen.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "我确认覆盖当前正文" }));
    fireEvent.change(screen.getByLabelText("当前正文"), { target: { value: "edited" } });
    fireEvent.click(screen.getByRole("button", { name: "保存", exact: true }));
    expect(p.actions.onEdit).toHaveBeenCalledWith("edited");
  });
  it("does not submit a refinement while an IME composition is active", () => {
    const p = props();
    render(<FormalContentPanel {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "继续优化", exact: true }));
    const input = screen.getByLabelText("优化要求");
    fireEvent.change(input, { target: { value: "Shorter" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(p.actions.onRefine).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter", isComposing: false });
    expect(p.actions.onRefine).toHaveBeenCalledWith("Shorter");
  });
});
