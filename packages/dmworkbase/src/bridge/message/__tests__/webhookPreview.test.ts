// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseWebhookIssuePreviewTarget,
  trustedFleetHosts,
  webhookPreviewClickHandler,
} from "../webhookPreview";
import APIClient from "../../../Service/APIClient";
import * as desktopBridge from "../../../electron/desktopBridge";

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
      parseWebhookIssuePreviewTarget("https://example.com/notfleet/a/issues/OPS-9")
    ).toBeNull();
    expect(
      parseWebhookIssuePreviewTarget("https://example.com/fleet/a/notissues/OPS-9")
    ).toBeNull();
    expect(
      parseWebhookIssuePreviewTarget("https://example.com/fleet/a/issues/")
    ).toBeNull();
  });

  it("explicit ports are structurally valid (trust decided by handler)", () => {
    expect(
      parseWebhookIssuePreviewTarget(
        "http://octo.example:8080/fleet/a/issues/OPS-9",
        "https://octo.example/chat"
      )
    ).toEqual({
      workspaceSlug: "a",
      issueIdentifier: "OPS-9",
      sourceUrl: "http://octo.example:8080/fleet/a/issues/OPS-9",
    });
  });
});

describe("trustedFleetHosts", () => {
  const apiURLOf = () => (APIClient.shared.config as unknown as { apiURL: string });

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

    handler({ target: anchor, preventDefault, stopPropagation } as any);
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
      preventDefault,
      stopPropagation: vi.fn(),
    } as any);
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    expect(ask).toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalled();
  });

  it("leaves the link untouched when the user rejects the unknown host", async () => {
    vi.spyOn(desktopBridge, "getElectronIpcBridge").mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ trusted: false }),
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
      preventDefault,
      stopPropagation: vi.fn(),
    } as any);
    await vi.waitFor(() => expect(open).not.toHaveBeenCalled());
    expect(preventDefault).not.toHaveBeenCalled();
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
      preventDefault,
      stopPropagation: vi.fn(),
    } as any);
    await vi.waitFor(() => expect(open).not.toHaveBeenCalled());
    expect(ask).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
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