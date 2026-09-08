import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SummaryMessagingPort } from "../host/types";

vi.mock("../api/summaryApi", () => ({ getSummaryShare: vi.fn() }));
vi.mock("../pages/SummaryShareDetailPage", () => ({
  default: ({ shareId }: { shareId: string }) => <div>snapshot:{shareId}</div>,
}));
vi.mock("../features/summaryShare/SummarySharePreviewFeature", () => ({
  default: ({ onClose, onOpenDetail }: { onClose: () => void; onOpenDetail: () => void }) =>
    <div><button onClick={onClose}>close-preview</button><button onClick={onOpenDetail}>open-detail</button></div>,
}));
import { getSummaryShare } from "../api/summaryApi";
import SummaryShareRoute from "./SummaryShareRoute";

const messaging = {} as SummaryMessagingPort;

describe("Summary share artifact routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps preview distinct from detail", () => {
    const onRouteChange = vi.fn();
    const route = { view: "share" as const, shareId: "s1", preview: true };
    render(<SummaryShareRoute route={route} onRouteChange={onRouteChange} messaging={messaging} />);
    expect(getSummaryShare).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("open-detail"));
    expect(onRouteChange).toHaveBeenCalledWith({ ...route, preview: false });
    fireEvent.click(screen.getByText("close-preview"));
    expect(onRouteChange).toHaveBeenCalledWith({ view: "list" });
  });

  it("opens an accessible original task and preserves its origin conversation", async () => {
    vi.mocked(getSummaryShare).mockResolvedValue({ source_accessible: true, snapshot: { task_id: 17 } } as never);
    const onRouteChange = vi.fn();
    const originConversation = { channelId: "g1", channelType: 2 };
    render(<SummaryShareRoute route={{ view: "share", shareId: "s1", originConversation }} onRouteChange={onRouteChange} messaging={messaging} />);
    await waitFor(() => expect(onRouteChange).toHaveBeenCalledWith({ view: "detail", taskId: 17, originConversation }));
  });

  it("falls back to the snapshot when the original is inaccessible", async () => {
    vi.mocked(getSummaryShare).mockResolvedValue({ source_accessible: false } as never);
    render(<SummaryShareRoute route={{ view: "share", shareId: "s1" }} onRouteChange={vi.fn()} messaging={messaging} />);
    expect(await screen.findByText("snapshot:s1")).toBeInTheDocument();
  });

  it("does not navigate after the workspace is unmounted", async () => {
    let resolve!: (result: never) => void;
    vi.mocked(getSummaryShare).mockReturnValue(new Promise((done) => { resolve = done; }));
    const onRouteChange = vi.fn();
    const view = render(<SummaryShareRoute route={{ view: "share", shareId: "s1" }} onRouteChange={onRouteChange} messaging={messaging} />);
    view.unmount();
    await act(async () => resolve({ source_accessible: true, snapshot: { task_id: 17 } } as never));
    expect(onRouteChange).not.toHaveBeenCalled();
  });
});
