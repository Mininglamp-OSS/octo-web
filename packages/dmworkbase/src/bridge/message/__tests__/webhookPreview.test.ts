// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  parseWebhookIssuePreviewTarget,
  webhookPreviewClickHandler,
} from "../webhookPreview";

describe("parseWebhookIssuePreviewTarget", () => {
  it("parses absolute and relative Fleet issue links", () => {
    expect(
      parseWebhookIssuePreviewTarget(
        "https://im.deepminer.com.cn/fleet/1/issues/WS-4"
      )
    ).toEqual({
      workspaceSlug: "1",
      issueIdentifier: "WS-4",
      sourceUrl: "https://im.deepminer.com.cn/fleet/1/issues/WS-4",
    });
    expect(
      parseWebhookIssuePreviewTarget(
        "/fleet/team-a/issues/OPS-9",
        "https://octo.example/chat"
      )
    ).toEqual({
      workspaceSlug: "team-a",
      issueIdentifier: "OPS-9",
      sourceUrl: "https://octo.example/fleet/team-a/issues/OPS-9",
    });
  });

  it("rejects unrelated and unsafe links", () => {
    expect(parseWebhookIssuePreviewTarget("https://example.com/docs/1")).toBeNull();
    expect(
      parseWebhookIssuePreviewTarget(
        "https://example.com/fleet/a/issues/OPS-9",
        "https://octo.example/chat"
      )
    ).toBeNull();
    expect(parseWebhookIssuePreviewTarget("javascript:alert(1)")).toBeNull();
    expect(parseWebhookIssuePreviewTarget("https://example.com/fleet/a/issues"))
      .toBeNull();
  });
});

describe("webhookPreviewClickHandler", () => {
  it("opens the exact Fleet link clicked in a webhook message", () => {
    const open = vi.fn();
    const message = { fromUID: "iwh_hook" } as any;
    const handler = webhookPreviewClickHandler(message, open)!;
    const anchor = document.createElement("a");
    anchor.href = "https://im.deepminer.com.cn/fleet/1/issues/WS-4";
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    handler({ target: anchor, preventDefault, stopPropagation } as any);

    expect(open).toHaveBeenCalledWith({
      workspaceSlug: "1",
      issueIdentifier: "WS-4",
      sourceUrl: "https://im.deepminer.com.cn/fleet/1/issues/WS-4",
    });
    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
  });

  it("does not intercept body text, unrelated links, or non-webhook messages", () => {
    const open = vi.fn();
    const body = document.createElement("div");
    const unrelated = document.createElement("a");
    unrelated.href = "https://example.com/docs/1";
    const event = (target: Element) => ({
      target,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }) as any;

    webhookPreviewClickHandler({ fromUID: "iwh_hook" } as any, open)!(event(body));
    webhookPreviewClickHandler({ fromUID: "iwh_hook" } as any, open)!(event(unrelated));
    expect(webhookPreviewClickHandler({ fromUID: "user" } as any, open)).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
  });
});
