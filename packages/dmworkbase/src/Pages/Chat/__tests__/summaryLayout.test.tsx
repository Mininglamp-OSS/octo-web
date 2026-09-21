import React from "react";
import { describe, expect, it, vi } from "vitest";
import { Channel } from "wukongimjssdk";
import { ChatContentPage } from "../index";
import type { Auxiliary } from "../responsiveLayout";

vi.mock("react-virtuoso", () => ({
  TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null,
}));
vi.mock("../../../Messages/Text/RichText", () => ({ default: () => null }));

interface LayoutHarness {
  layoutObserver: { update: (kind: Auxiliary) => void };
  updateResponsiveLayout(): void;
}

describe("summary side panel layout integration", () => {
  it.each(["split", "overlay"] as const)("uses the %s layout without unmounting the conversation", (panelLayout) => {
    const page = new ChatContentPage({ channel: new Channel("summary-layout", 2) });
    page.state = { ...page.state, showSummaryPanel: true, contentLayout: { panelLayout, navigationCollapsed: false } };
    const root = page.render();
    expect(root.props["data-chat-panel-layout"]).toBe(panelLayout);
    expect(root.props["data-chat-parent-hidden"]).toBe(panelLayout === "overlay" || undefined);
    expect(React.Children.toArray(root.props.children).some(child =>
      React.isValidElement<{ conversationProps?: unknown }>(child) && child.props.conversationProps,
    )).toBe(true);
  });

  it("updates the shared layout observer when summary opens and closes", () => {
    const page = new ChatContentPage({ channel: new Channel("summary-layout", 2) });
    const update = vi.fn();
    const harness = page as unknown as LayoutHarness;
    harness.layoutObserver = { update };
    page.state = { ...page.state, showSummaryPanel: true };
    harness.updateResponsiveLayout();
    expect(update).toHaveBeenLastCalledWith("summary");
    page.state = { ...page.state, showSummaryPanel: false };
    harness.updateResponsiveLayout();
    expect(update).toHaveBeenLastCalledWith(false);
    expect(page.render().props["data-chat-panel-layout"]).toBeUndefined();
  });
});
