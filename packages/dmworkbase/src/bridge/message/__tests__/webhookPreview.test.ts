// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  openFleetLinkExternal,
  parseFleetIssueLinkShape,
  parseWebhookIssuePreviewTarget,
  trustedFleetHosts,
  webhookPreviewClickHandler,
} from "../webhookPreview";
import APIClient from "../../../Service/APIClient";
import * as desktopBridge from "../../../electron/desktopBridge";

describe("parseWebhookIssuePreviewTarget (structure + static trust gate)", () => {
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

  it("accepts a same-host Fleet link when only the protocol differs", () => {
    expect(
      parseWebhookIssuePreviewTarget(
        "http://octo.example/fleet/team-a/issues/OPS-9",
        "https://octo.example/chat"
      )
    ).toEqual({
      workspaceSlug: "team-a",
      issueIdentifier: "OPS-9",
      sourceUrl: "http://octo.example/fleet/team-a/issues/OPS-9",
    });
  });

  it("rejects unsafe protocols and malformed fleet paths", () => {
    expect(parseWebhookIssuePreviewTarget("https://example.com/docs/1")).toBeNull();
    expect(parseWebhookIssuePreviewTarget("javascript:alert(1)")).toBeNull();
    expect(parseWebhookIssuePreviewTarget("https://example.com/fleet/a/issues"))
      .toBeNull();
    expect(
      parseWebhookIssuePreviewTarget(
        "https://example.com/notfleet/a/issues/OPS-9"
      )
    ).toBeNull();
    expect(
      parseWebhookIssuePreviewTarget(
        "https://example.com/fleet/a/notissues/OPS-9"
      )
    ).toBeNull();
    expect(
      parseWebhookIssuePreviewTarget("https://example.com/fleet/a/issues/")
    ).toBeNull();
  });

  it("rejects an unknown host (card path must not open attacker fleet links)", () => {
    // P1-1 regression: a webhook adaptive-card Action.OpenUrl on an unknown
    // host must NOT reach the preview (the full parse keeps the trust gate).
    expect(
      parseWebhookIssuePreviewTarget(
        "https://attacker.example/fleet/a/issues/OPS-9",
        "https://octo.example/chat"
      )
    ).toBeNull();
  });

  it("rejects a trusted host on a non-default port", () => {
    // P2-2: trusted-host clause requires a default port; :9999 must fail
    // even for a static/API-trusted hostname.
    expect(
      parseWebhookIssuePreviewTarget(
        "https://im.deepminer.com.cn:9999/fleet/a/issues/OPS-9"
      )
    ).toBeNull();
    expect(
      parseWebhookIssuePreviewTarget(
        "http://octo.example:8080/fleet/a/issues/OPS-9",
        "https://octo.example/chat"
      )
    ).toBeNull();
  });

  it("accepts a trusted host on the default port explicitly", () => {
    // Note: URL normalizes the explicit :443 into the default port, so the
    // parsed href drops it; the important assertion is that it is NOT rejected.
    expect(
      parseWebhookIssuePreviewTarget(
        "https://im.deepminer.com.cn:443/fleet/a/issues/OPS-9"
      )
    ).toEqual({
      workspaceSlug: "a",
      issueIdentifier: "OPS-9",
      sourceUrl: "https://im.deepminer.com.cn/fleet/a/issues/OPS-9",
    });
  });
});

describe("parseFleetIssueLinkShape (structure only, no trust)", () => {
  it("parses any well-formed fleet link regardless of host", () => {
    expect(
      parseFleetIssueLinkShape(
        "https://attacker.example/fleet/a/issues/OPS-9",
        "https://octo.example/chat"
      )
    ).toEqual({
      workspaceSlug: "a",
      issueIdentifier: "OPS-9",
      sourceUrl: "https://attacker.example/fleet/a/issues/OPS-9",
    });
    // 非默认端口在形状层仍可解析（信任决策交给调用方）
    expect(
      parseFleetIssueLinkShape(
        "http://octo.example:8080/fleet/a/issues/OPS-9",
        "https://octo.example/chat"
      )
    ).toEqual({
      workspaceSlug: "a",
      issueIdentifier: "OPS-9",
      sourceUrl: "http://octo.example:8080/fleet/a/issues/OPS-9",
    });
  });

  it("rejects unsafe protocols and malformed paths", () => {
    expect(parseFleetIssueLinkShape("javascript:alert(1)")).toBeNull();
    expect(parseFleetIssueLinkShape("https://example.com/docs/1")).toBeNull();
    expect(parseFleetIssueLinkShape("https://example.com/fleet/a/issues")).toBeNull();
  });
});

describe("trustedFleetHosts", () => {
  const apiURLOf = () => (APIClient.shared.config as unknown as { apiURL: string });
  const originalApiURL = apiURLOf().apiURL;

  afterEach(() => {
    // P2-5: restore the mutated apiURL so the suite is order-independent.
    apiURLOf().apiURL = originalApiURL;
  });

  it("includes the static fallback host", () => {
    expect(trustedFleetHosts()).toContain("im.deepminer.com.cn");
  });

  it("includes the current API origin host", () => {
    apiURLOf().apiURL = "https://im-test.deepminer.com.cn/v1/";
    expect(trustedFleetHosts()).toContain("im-test.deepminer.com.cn");
  });

  it("tolerates a missing or malformed apiURL", () => {
    apiURLOf().apiURL = "";
    expect(trustedFleetHosts()).toContain("im.deepminer.com.cn");
    apiURLOf().apiURL = "not-a-url";
    expect(trustedFleetHosts()).toContain("im.deepminer.com.cn");
  });
});

describe("webhookPreviewClickHandler", () => {
  const flushAsync = () =>
    new Promise<void>((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    vi.restoreAllMocks();
    (APIClient.shared.config as unknown as { apiURL: string }).apiURL =
      "https://octo.example/v1/";
    window.__POWERED_ELECTRON__ = false;
  });

  it("opens a trusted Fleet link immediately without prompting", async () => {
    const open = vi.fn();
    const message = { fromUID: "iwh_hook" } as any;
    const handler = webhookPreviewClickHandler(message, open)!;
    const anchor = document.createElement("a");
    anchor.href = "https://octo.example/fleet/1/issues/WS-4";
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    handler({ target: anchor, button: 0, preventDefault, stopPropagation } as any);
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    expect(open).toHaveBeenCalledWith({
      workspaceSlug: "1",
      issueIdentifier: "WS-4",
      sourceUrl: "https://octo.example/fleet/1/issues/WS-4",
    });
    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
  });

  it("opens a static-fallback host link (desktop file://) without prompting", async () => {
    const open = vi.fn();
    const handler = webhookPreviewClickHandler(
      { fromUID: "iwh_hook" } as any,
      open
    )!;
    const anchor = document.createElement("a");
    // file:// base => same-origin impossible; static host must still pass.
    anchor.href = "https://im.deepminer.com.cn/fleet/1/issues/WS-4";
    const preventDefault = vi.fn();

    handler({
      target: anchor,
      button: 0,
      preventDefault,
      stopPropagation: vi.fn(),
    } as any);
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
  });

  it("prompts for an unknown fleet host and opens after the user allows it", async () => {
    const ask = vi
      .spyOn(desktopBridge, "getElectronIpcBridge")
      .mockReturnValue({
        invoke: vi.fn().mockResolvedValue({ trusted: true }),
      } as any);
    window.__POWERED_ELECTRON__ = true;

    const open = vi.fn();
    const handler = webhookPreviewClickHandler(
      { fromUID: "iwh_hook" } as any,
      open
    )!;
    const anchor = document.createElement("a");
    anchor.href = "https://onprem.customer.com/fleet/1/issues/WS-4";
    const preventDefault = vi.fn();

    handler({
      target: anchor,
      button: 0,
      preventDefault,
      stopPropagation: vi.fn(),
    } as any);
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    expect(ask).toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalled();
  });

  it("rejects the unknown host and explicitly opens the link externally", async () => {
    vi.spyOn(desktopBridge, "getElectronIpcBridge").mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ trusted: false }),
    } as any);
    window.__POWERED_ELECTRON__ = true;

    const open = vi.fn();
    const fallback = vi.fn();
    const handler = webhookPreviewClickHandler(
      { fromUID: "iwh_hook" } as any,
      open,
      fallback
    )!;
    const anchor = document.createElement("a");
    anchor.href = "https://onprem.customer.com/fleet/1/issues/WS-4";
    const preventDefault = vi.fn();
    // P1-2: default action is cancelled synchronously for fleet-shaped links;
    // on rejection the handler consciously re-opens the link (fallback),
    // rather than relying on a default that already fired.
    handler({
      target: anchor,
      button: 0,
      preventDefault,
      stopPropagation: vi.fn(),
    } as any);
    await vi.waitFor(() => {
      expect(open).not.toHaveBeenCalled();
      expect(fallback).toHaveBeenCalledWith(
        "https://onprem.customer.com/fleet/1/issues/WS-4"
      );
    });
    expect(preventDefault).toHaveBeenCalled();
  });

  it("does not prompt for non-fleet links on unknown hosts", async () => {
    const ask = vi.spyOn(desktopBridge, "getElectronIpcBridge");
    window.__POWERED_ELECTRON__ = true;

    const open = vi.fn();
    const handler = webhookPreviewClickHandler(
      { fromUID: "iwh_hook" } as any,
      open
    )!;
    const anchor = document.createElement("a");
    anchor.href = "https://onprem.customer.com/docs/1";
    const preventDefault = vi.fn();

    handler({
      target: anchor,
      button: 0,
      preventDefault,
      stopPropagation: vi.fn(),
    } as any);
    // Flush the micro/task queue before the negative assertion so a wrongly
    // async continuation would have run (vi.waitFor-style negatives resolve
    // on their first tick and prove nothing).
    await flushAsync();
    expect(open).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("does not intercept right-click (auxclick button 2) — context menu path", async () => {
    const ask = vi.spyOn(desktopBridge, "getElectronIpcBridge");
    const open = vi.fn();
    const handler = webhookPreviewClickHandler(
      { fromUID: "iwh_hook" } as any,
      open
    )!;
    const anchor = document.createElement("a");
    anchor.href = "https://octo.example/fleet/1/issues/WS-4";
    const preventDefault = vi.fn();

    // auxclick also fires for the secondary button; right-clicking a fleet
    // link (to copy the address) must fall through to the context menu.
    handler({
      target: anchor,
      button: 2,
      preventDefault,
      stopPropagation: vi.fn(),
    } as any);
    await flushAsync();
    expect(open).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("does not intercept body text, unrelated links, or non-webhook messages", async () => {
    const open = vi.fn();
    const body = document.createElement("div");
    const unrelated = document.createElement("a");
    unrelated.href = "https://example.com/docs/1";
    const event = (target: Element) => ({
      target,
      button: 0,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }) as any;

    webhookPreviewClickHandler({ fromUID: "iwh_hook" } as any, open)!(event(body));
    webhookPreviewClickHandler({ fromUID: "iwh_hook" } as any, open)!(event(unrelated));
    expect(webhookPreviewClickHandler({ fromUID: "user" } as any, open)).toBeUndefined();
    await flushAsync();
    expect(open).not.toHaveBeenCalled();
  });

  it("intercepts middle-click (auxclick) on a trusted fleet link", async () => {
    const open = vi.fn();
    const handler = webhookPreviewClickHandler(
      { fromUID: "iwh_hook" } as any,
      open
    )!;
    const anchor = document.createElement("a");
    anchor.href = "https://octo.example/fleet/1/issues/WS-4";
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    handler({
      target: anchor,
      button: 1, // middle button
      preventDefault,
      stopPropagation,
    } as any);
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    expect(open).toHaveBeenCalledWith({
      workspaceSlug: "1",
      issueIdentifier: "WS-4",
      sourceUrl: "https://octo.example/fleet/1/issues/WS-4",
    });
    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
  });

  it("does not intercept middle-click on non-fleet or unknown links", async () => {
    const open = vi.fn();
    const handler = webhookPreviewClickHandler(
      { fromUID: "iwh_hook" } as any,
      open
    )!;
    const unrelated = document.createElement("a");
    unrelated.href = "https://example.com/docs/1";
    const preventDefault = vi.fn();

    handler({
      target: unrelated,
      button: 1,
      preventDefault,
      stopPropagation: vi.fn(),
    } as any);
    // Flush before the negative assertion (see the button-0 variant above).
    await flushAsync();
    expect(open).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
