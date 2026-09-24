import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { i18n, I18nProvider } from "../../i18n";
import { WorkspaceGroupEntry, type WorkspaceGroupEntryProps } from "./index";

const workspace = {
  projectName: "Data Intelligence", linkedByName: "Evan",
  canOpen: true, canManage: true, isAllMemberGroup: false,
};
function setup(overrides: Partial<WorkspaceGroupEntryProps> = {}) {
  const props = { workspace, onOpen: vi.fn(), onManage: vi.fn(), onRetry: vi.fn(), ...overrides };
  const result = render(<I18nProvider><WorkspaceGroupEntry {...props} /></I18nProvider>);
  return { ...result, props };
}

describe("WorkspaceGroupEntry", () => {
  beforeEach(() => i18n.setLocale("en-US", { persist: false }));

  it("renders nothing without a relation", () => {
    setup({ workspace: null });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps initial load failure distinguishable from an unlinked group and allows retry", () => {
    const { props } = setup({ workspace: null, error: "Unable to update the relation." });
    fireEvent.click(screen.getByRole("button", { name: "Unable to update the relation. Retry" }));
    expect(props.onRetry).toHaveBeenCalledOnce();
    expect(props.onOpen).not.toHaveBeenCalled();
    expect(props.onManage).not.toHaveBeenCalled();
  });

  it("renders a disabled loading control before the first relation is available", () => {
    setup({ workspace: null, refreshing: true });
    expect(screen.getByRole("button", { name: "Updating relation…" })).toBeDisabled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("uses the Client workspace icon without an extra navigation arrow", () => {
    setup();
    const jump = screen.getByRole("button", { name: "Open workspace: Data Intelligence" });
    expect(jump.querySelector(".lucide-layout-grid")).toBeInTheDocument();
    expect(jump.querySelectorAll("svg")).toHaveLength(1);
    expect(jump).toHaveClass("wk-btn--ghost");
    expect(screen.getByRole("button", { name: "View and manage workspace relation" }))
      .toHaveAttribute("aria-haspopup", "dialog");
  });

  it("keeps the complete workspace name accessible while loading", () => {
    const { rerender } = setup();
    const name = "Cross-organization Customer Data Access and Intelligence";
    rerender(<I18nProvider><WorkspaceGroupEntry
      workspace={{ ...workspace, projectName: name }} busy="open"
      onOpen={vi.fn()} onManage={vi.fn()} onRetry={vi.fn()} /></I18nProvider>);
    const jump = screen.getByRole("button", { name: `Open workspace: ${name}` });
    expect(jump).toBeDisabled();
    expect(jump).toHaveTextContent(name);
    expect(jump.querySelector(".wk-btn__spinner")).toBeInTheDocument();
  });

  it("opens the workspace directly and manages through a separate disclosure", async () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Open workspace: Data Intelligence" }));
    expect(props.onOpen).toHaveBeenCalledOnce();
    expect(props.onManage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "View and manage workspace relation" }));
    expect(await screen.findByRole("dialog", { name: "Workspace relation" })).toBeVisible();
    expect(screen.getByText("Evan")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Manage relation" }));
    expect(props.onManage).toHaveBeenCalledOnce();
  });

  it.each(["en-US", "zh-CN"])("only presents workspace and actor metadata in %s", async (locale) => {
    i18n.setLocale(locale as "en-US" | "zh-CN", { persist: false });
    const legacyContext = { ...workspace, source: "linked_existing", linkedAt: "2026-08-15T02:20:00Z" };
    setup({ workspace: legacyContext, defaultOpen: true });
    const dialog = await screen.findByRole("dialog", {
      name: locale === "zh-CN" ? "工作空间关联" : "Workspace relation",
    });
    expect(within(dialog).getByRole("heading", { name: workspace.projectName })).toBeVisible();
    expect(within(dialog).getByText("Evan")).toBeVisible();
    expect(dialog.querySelectorAll("dt")).toHaveLength(1);
    expect(dialog.querySelector("time")).toBeNull();
    expect(within(dialog).queryByText(/关联方式|关联时间|时间未记录|Link method|Linked at|Existing group linked/)).toBeNull();
    expect(dialog).not.toHaveTextContent("2026-08-15");
  });

  it.each([
    { canManage: false, isAllMemberGroup: false, text: "Only group owners or group administrators who also belong to this workspace can manage this relation." },
    { canManage: true, isAllMemberGroup: true, text: "This all-member group is managed by the system and cannot be unlinked." },
  ])("does not expose management for restricted groups: %j", async ({ canManage, isAllMemberGroup, text }) => {
    setup({ workspace: { ...workspace, canManage, isAllMemberGroup }, defaultOpen: true });
    expect(await screen.findByText(text)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Manage relation" })).toBeNull();
  });

  it.each([
    { reason: "denied" as const, text: "Your account does not have permission to manage this relation." },
    { reason: "unavailable" as const, text: "Unable to verify relation permissions. Please try again." },
  ])("explains permission restrictions without exposing management", async ({ reason, text }) => {
    setup({ workspace: { ...workspace, canManage: false, manageDisabledReason: reason }, defaultOpen: true });
    expect(await screen.findByText(text)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Manage relation" })).toBeNull();
  });

  it("separates workspace access from permission to inspect the relation", async () => {
    setup({ workspace: { ...workspace, canOpen: false } });
    expect(screen.getByRole("button", { name: "Open workspace: Data Intelligence" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "View and manage workspace relation" }));
    expect(await screen.findByRole("dialog", { name: "Workspace relation" })).toBeVisible();
  });

  it("exposes retry and keeps stale actions disabled after failure", async () => {
    const { props } = setup({ error: "Unable to update the relation." });
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to update");
    expect(screen.getByRole("button", { name: "Manage relation" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(props.onRetry).toHaveBeenCalledOnce();
  });

  it("closes with Escape and restores disclosure focus", async () => {
    setup();
    const disclosure = screen.getByRole("button", { name: "View and manage workspace relation" });
    fireEvent.click(disclosure);
    const dialog = await screen.findByRole("dialog", { name: "Workspace relation" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(disclosure).toHaveAttribute("aria-expanded", "false"));
    expect(disclosure).toHaveFocus();
  });

  it("localizes the name and labels in Chinese", () => {
    i18n.setLocale("zh-CN", { persist: false });
    setup();
    expect(screen.getByRole("button", { name: "进入工作空间：Data Intelligence" })).toBeVisible();
  });
});
