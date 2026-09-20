import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { i18n, I18nProvider } from "../../i18n";
import { WorkspaceGroupEntry, type WorkspaceGroupEntryProps } from "./index";

const workspace = {
  projectName: "Data Intelligence", linkedByName: "Evan",
  source: "linked_existing" as const, canOpen: true, canManage: true, isAllMemberGroup: false,
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
