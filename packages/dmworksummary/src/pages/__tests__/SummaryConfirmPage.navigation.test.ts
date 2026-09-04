import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/summaryApi", () => ({
  declineParticipation: vi.fn(),
}));
vi.mock("../../utils/summaryAttentionBadge", () => ({
  refreshSummaryAttentionBadge: vi.fn(),
}));
vi.mock("../../components/SourceSelector", () => ({ default: () => null }));
vi.mock("../../components/ConfirmParticipantList", () => ({
  default: () => null,
}));
vi.mock("../SummaryDetailPage", () => ({ default: () => null }));

import WKApp from "@octo/base/src/App";
import * as api from "../../api/summaryApi";
import SummaryConfirmPage from "../SummaryConfirmPage";

describe("SummaryConfirmPage controlled navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (WKApp as any).routeLeft = {
      push: vi.fn(),
      popToRoot: vi.fn(),
    };
  });

  it("delegates back navigation to the workspace", () => {
    const onBack = vi.fn();
    const page = new SummaryConfirmPage({ taskId: 7, onBack });

    page.handleBack();

    expect(onBack).toHaveBeenCalledTimes(1);
    expect((WKApp as any).routeLeft.push).not.toHaveBeenCalled();
  });

  it("delegates successful decline navigation to the workspace", async () => {
    const onDeclined = vi.fn();
    vi.mocked(api.declineParticipation).mockResolvedValue(undefined as any);
    const page = new SummaryConfirmPage({ taskId: 7, onDeclined });
    (page as any).setState = function (this: any, patch: any) {
      this.state = {
        ...this.state,
        ...(typeof patch === "function" ? patch(this.state) : patch),
      };
    };

    await page.handleDecline();

    expect(onDeclined).toHaveBeenCalledTimes(1);
    expect((WKApp as any).routeLeft.popToRoot).not.toHaveBeenCalled();
  });
});
