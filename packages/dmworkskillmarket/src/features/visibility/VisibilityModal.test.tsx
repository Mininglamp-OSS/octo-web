import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WKApp } from "@octo/base";
import VisibilityModal from "./VisibilityModal";
import {
  getPublishedAudience,
  changePublishedAudience,
} from "../../api/skillApiReal";
vi.mock("../../api/skillApiReal", () => ({
  getPublishedAudience: vi.fn(),
  changePublishedAudience: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(getPublishedAudience)
    .mockReset()
    .mockResolvedValue({
      name: "Published skill",
      visibility: "private",
      publishedVersionId: "released-v1",
    });
  vi.mocked(changePublishedAudience)
    .mockReset()
    .mockResolvedValue({
      visibility: "private",
      published_version_id: "released-v1",
      display_status: "pending_review",
    });
});
describe("published audience management", () => {
  it("changes audience using the displayed release, without version or changelog inputs", async () => {
    const onSaved = vi.fn(),
      onClose = vi.fn();
    render(
      <VisibilityModal pluginId="skill-1" onSaved={onSaved} onClose={onClose} />
    );
    await screen.findByText("Published skill");
    expect(document.querySelectorAll('input:not([type="radio"])')).toHaveLength(
      0
    );
    fireEvent.click(document.querySelector('input[value="space"]')!);
    fireEvent.click(
      screen.getByRole("button", { name: /保存|skillMarket.common.save/ })
    );
    await waitFor(() =>
      expect(changePublishedAudience).toHaveBeenCalledWith(
        "skill-1",
        "released-v1",
        "space"
      )
    );
    expect(onSaved).toHaveBeenCalledWith(
      expect.stringMatching(/审核|skillMarket.visibility.submitted/)
    );
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("retains the choice and surfaces a reference failure for retry", async () => {
    vi.mocked(changePublishedAudience).mockRejectedValueOnce(
      new Error("Published dependency prevents narrowing")
    );
    render(
      <VisibilityModal pluginId="skill-1" onSaved={vi.fn()} onClose={vi.fn()} />
    );
    await screen.findByText("Published skill");
    fireEvent.click(document.querySelector('input[value="space"]')!);
    const save = screen.getByRole("button", {
      name: /保存|skillMarket.common.save/,
    });
    fireEvent.click(save);
    await screen.findByRole("alert");
    expect(document.querySelector('input[value="space"]')).toBeChecked();
    expect(save).toBeEnabled();
  });
  it("closes on Space change without applying a stale read", async () => {
    const onClose = vi.fn();
    render(
      <VisibilityModal pluginId="skill-1" onSaved={vi.fn()} onClose={onClose} />
    );
    await screen.findByText("Published skill");
    WKApp.mittBus.emit("space-changed");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
