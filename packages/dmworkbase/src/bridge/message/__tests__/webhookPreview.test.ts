// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseFleetIssueLinkShape,
  parseWebhookIssuePreviewTarget,
  trustedFleetHosts,
  fleetPreviewClickHandler,
  isFleetPreviewSupported,
} from "../webhookPreview";
import APIClient from "../../../Service/APIClient";
import { EndpointManager } from "../../../Service/Module";
import * as desktopBridge from "../../../electron/desktopBridge";

/** A synthetic `click` (button 0) unless overridden. */
const clickEvent = (target: Element, overrides: Record<string, unknown> = {}) =>
  ({
    target,
    type: "click",
    button: 0,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  }) as any;

/** A synthetic middle-button `auxclick` (button 1) unless overridden. */
const auxClickEvent = (target: Element, overrides: Record<string, unknown> = {}) =>
  clickEvent(target, { type: "auxclick", button: 1, ...overrides });

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
    // Round-1 P1-1 regression: a webhook adaptive-card Action.OpenUrl on an
    // unknown host must NOT reach the preview (the full parse keeps the gate).
    expect(
      parseWebhookIssuePreviewTarget(
        "https://attacker.example/fleet/a/issues/OPS-9",
        "https://octo.example/chat"
      )
    ).toBeNull();
  });

  it("trust keys include the port: a different port on the same hostname is NOT trusted", () => {
    // Round-3 P1-1: trust is keyed on URL.host (hostname + non-default
    // port). :9999 must fail even for a static/API-trusted hostname —
    // otherwise a remembered `x` would silently trust `x:9999`.
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

  it("accepts a trusted host with the default port spelled out (normalized away)", () => {
    // URL normalizes the explicit :443 into the default port, so the parsed
    // href drops it; the important assertion is that it is NOT rejected.
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

  it("auto-trusts an API origin on a non-default port — and only that port", () => {
    // Round-3 P1-1 failure mode B: an on-prem deployment whose API origin
    // carries a non-default port must get previews for ITS port, while the
    // same hostname on the default port (or any other port) stays untrusted.
    const apiURLOf = () =>
      APIClient.shared.config as unknown as { apiURL: string };
    const original = apiURLOf().apiURL;
    apiURLOf().apiURL = "https://onprem.customer.com:8443/api/v1/";
    try {
      // the API port itself: trusted
      expect(
        parseWebhookIssuePreviewTarget(
          "https://onprem.customer.com:8443/fleet/a/issues/OPS-9",
          "https://octo.example/chat"
        )
      ).toEqual({
        workspaceSlug: "a",
        issueIdentifier: "OPS-9",
        sourceUrl: "https://onprem.customer.com:8443/fleet/a/issues/OPS-9",
      });
      // same hostname, default port: NOT trusted
      expect(
        parseWebhookIssuePreviewTarget(
          "https://onprem.customer.com/fleet/a/issues/OPS-9",
          "https://octo.example/chat"
        )
      ).toBeNull();
      // same hostname, another port: NOT trusted (a remembered
      // `onprem.customer.com:8443` must not trust `:9999`)
      expect(
        parseWebhookIssuePreviewTarget(
          "https://onprem.customer.com:9999/fleet/a/issues/OPS-9",
          "https://octo.example/chat"
        )
      ).toBeNull();
    } finally {
      apiURLOf().apiURL = original;
    }
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
    // Round-3 P2-8: restore the mutated apiURL so the suite is
    // order-independent.
    apiURLOf().apiURL = originalApiURL;
  });

  it("includes the static fallback host", () => {
    expect(trustedFleetHosts()).toContain("im.deepminer.com.cn");
  });

  it("includes the current API origin host", () => {
    apiURLOf().apiURL = "https://im-test.deepminer.com.cn/v1/";
    expect(trustedFleetHosts()).toContain("im-test.deepminer.com.cn");
  });

  it("keeps a non-default API port as part of the trust key", () => {
    apiURLOf().apiURL = "https://im-test.deepminer.com.cn:8443/v1/";
    expect(trustedFleetHosts()).toContain("im-test.deepminer.com.cn:8443");
    expect(trustedFleetHosts()).not.toContain("im-test.deepminer.com.cn");
  });

  it("normalizes an explicit default port away", () => {
    apiURLOf().apiURL = "https://im-test.deepminer.com.cn:443/v1/";
    expect(trustedFleetHosts()).toContain("im-test.deepminer.com.cn");
  });

  it("tolerates a missing or malformed apiURL", () => {
    apiURLOf().apiURL = "";
    expect(trustedFleetHosts()).toContain("im.deepminer.com.cn");
    apiURLOf().apiURL = "not-a-url";
    expect(trustedFleetHosts()).toContain("im.deepminer.com.cn");
  });
});

describe("fleetPreviewClickHandler", () => {
  const flushAsync = () =>
    new Promise<void>((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    vi.restoreAllMocks();
    (APIClient.shared.config as unknown as { apiURL: string }).apiURL =
      "https://octo.example/v1/";
    window.__POWERED_ELECTRON__ = false;
    // The handler is gated on a registered preview renderer
    // (isFleetPreviewSupported); simulate an enterprise build that has one.
    vi.spyOn(EndpointManager.shared, "getWithCategory").mockReturnValue([
      {} as never,
    ]);
  });

  it("opens a trusted Fleet link immediately without prompting", async () => {
    const open = vi.fn();
    const handler = fleetPreviewClickHandler(open)!;
    const anchor = document.createElement("a");
    anchor.href = "https://octo.example/fleet/1/issues/WS-4";

    const event = clickEvent(anchor);
    handler(event);
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    expect(open).toHaveBeenCalledWith({
      workspaceSlug: "1",
      issueIdentifier: "WS-4",
      sourceUrl: "https://octo.example/fleet/1/issues/WS-4",
    });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it("opens a static-fallback host link (same-origin impossible) without prompting", async () => {
    const open = vi.fn();
    const handler = fleetPreviewClickHandler(open)!;
    const anchor = document.createElement("a");
    // The base here is jsdom's http://localhost, so same-origin can never
    // match; the static fallback host must still open the preview (this is
    // the desktop file:// scenario: origin is null there).
    anchor.href = "https://im.deepminer.com.cn/fleet/1/issues/WS-4";
    const preventDefault = vi.fn();

    handler(clickEvent(anchor, { preventDefault }));
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
    const handler = fleetPreviewClickHandler(open)!;
    const anchor = document.createElement("a");
    anchor.href = "https://onprem.customer.com/fleet/1/issues/WS-4";
    const preventDefault = vi.fn();

    handler(clickEvent(anchor, { preventDefault }));
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
    const handler = fleetPreviewClickHandler(open, fallback)!;
    const anchor = document.createElement("a");
    anchor.href = "https://onprem.customer.com/fleet/1/issues/WS-4";
    const preventDefault = vi.fn();
    // Round-1 P1-2: default action is cancelled synchronously for
    // fleet-shaped links; on rejection the handler consciously re-opens the
    // link (fallback), rather than relying on a default that already fired.
    handler(clickEvent(anchor, { preventDefault }));
    await vi.waitFor(() => {
      expect(open).not.toHaveBeenCalled();
      expect(fallback).toHaveBeenCalledWith(
        "https://onprem.customer.com/fleet/1/issues/WS-4"
      );
    });
    expect(preventDefault).toHaveBeenCalled();
  });

  it("leaves unknown-host fleet links to the browser default on web (no prompt bridge)", async () => {
    // Round-3 P2-6: web renderers cannot ask, so an unknown-origin fleet
    // link must NOT be preventDefault-ed — the anchor's default action (new
    // tab) is the correct outcome and keeps popup-blocker heuristics happy.
    const ask = vi.spyOn(desktopBridge, "getElectronIpcBridge");
    window.__POWERED_ELECTRON__ = false;

    const open = vi.fn();
    const fallback = vi.fn();
    const handler = fleetPreviewClickHandler(open, fallback)!;
    const anchor = document.createElement("a");
    anchor.href = "https://onprem.customer.com/fleet/1/issues/WS-4";

    handler(clickEvent(anchor));
    await flushAsync();
    expect(open).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it("does not prompt for non-fleet links on unknown hosts", async () => {
    const ask = vi.spyOn(desktopBridge, "getElectronIpcBridge");
    window.__POWERED_ELECTRON__ = true;

    const open = vi.fn();
    const handler = fleetPreviewClickHandler(open)!;
    const anchor = document.createElement("a");
    anchor.href = "https://onprem.customer.com/docs/1";

    handler(clickEvent(anchor));
    // Flush the micro/task queue before the negative assertion so a wrongly
    // async continuation would have run (vi.waitFor-style negatives resolve
    // on their first tick and prove nothing).
    await flushAsync();
    expect(open).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
  });

  it("does not intercept right-click (auxclick button 2) — context menu path", async () => {
    const ask = vi.spyOn(desktopBridge, "getElectronIpcBridge");
    const open = vi.fn();
    const handler = fleetPreviewClickHandler(open)!;
    const anchor = document.createElement("a");
    anchor.href = "https://octo.example/fleet/1/issues/WS-4";

    // auxclick also fires for the secondary button; right-clicking a fleet
    // link (to copy the address) must fall through to the context menu.
    handler(auxClickEvent(anchor, { button: 2 }));
    await flushAsync();
    expect(open).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
  });

  it("ignores a middle-click's phantom click event (Firefox double dispatch)", async () => {
    // Firefox dispatches BOTH click(button=1) and auxclick(button=1) for a
    // middle click. Only the auxclick leg may act, so a single gesture opens
    // exactly one preview.
    const open = vi.fn();
    const handler = fleetPreviewClickHandler(open)!;
    const anchor = document.createElement("a");
    anchor.href = "https://octo.example/fleet/1/issues/WS-4";

    handler(clickEvent(anchor, { button: 1 }));
    await flushAsync();
    expect(open).not.toHaveBeenCalled();
  });

  it("does not intercept body text or unrelated links, and no preview callback means no handler", async () => {
    const open = vi.fn();
    const body = document.createElement("div");
    const unrelated = document.createElement("a");
    unrelated.href = "https://example.com/docs/1";

    fleetPreviewClickHandler(open)!(clickEvent(body));
    fleetPreviewClickHandler(open)!(clickEvent(unrelated));
    // The handler is message-source-agnostic (webhook and plain user
    // messages share it); without a preview callback there is nothing to
    // route to, so the factory returns undefined and the MessageRow hit
    // area is not rendered at all.
    expect(fleetPreviewClickHandler(undefined)).toBeUndefined();
    await flushAsync();
    expect(open).not.toHaveBeenCalled();
  });

  it("is disabled entirely when no preview renderer is registered (OSS build)", async () => {
    // P1-4: without a registered chatWebhookIssuePreview endpoint the panel
    // would be a dead "unavailable" shell, so fleet links must keep their
    // default behaviour instead of being intercepted. gate on the registry.
    vi.spyOn(EndpointManager.shared, "getWithCategory").mockReturnValue(undefined);
    const open = vi.fn();
    const handler = fleetPreviewClickHandler(open);
    expect(handler).toBeUndefined();
    expect(isFleetPreviewSupported()).toBe(false);
  });

  it("intercepts middle-click (auxclick) on a trusted fleet link", async () => {
    const open = vi.fn();
    const handler = fleetPreviewClickHandler(open)!;
    const anchor = document.createElement("a");
    anchor.href = "https://octo.example/fleet/1/issues/WS-4";

    const event = auxClickEvent(anchor);
    handler(event);
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    expect(open).toHaveBeenCalledWith({
      workspaceSlug: "1",
      issueIdentifier: "WS-4",
      sourceUrl: "https://octo.example/fleet/1/issues/WS-4",
    });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it("does not intercept middle-click on non-fleet links", async () => {
    const open = vi.fn();
    const handler = fleetPreviewClickHandler(open)!;
    const unrelated = document.createElement("a");
    unrelated.href = "https://example.com/docs/1";
    const preventDefault = vi.fn();

    handler(auxClickEvent(unrelated, { preventDefault }));
    // Flush before the negative assertion (see the click variant above).
    await flushAsync();
    expect(open).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("fans out exactly one prompt for repeated clicks while trust is pending", async () => {
    // Round-3 P2-4: a link whose trust prompt is still in flight must not
    // queue a second prompt / preview / fallback tab on re-click.
    let resolveAsk: (v: { trusted: boolean }) => void = () => {};
    const invoke = vi.fn().mockImplementation(
      () => new Promise<{ trusted: boolean }>((r) => (resolveAsk = r))
    );
    vi.spyOn(desktopBridge, "getElectronIpcBridge").mockReturnValue({
      invoke,
    } as any);
    window.__POWERED_ELECTRON__ = true;

    const open = vi.fn();
    const fallback = vi.fn();
    const handler = fleetPreviewClickHandler(open, fallback)!;
    const anchor = document.createElement("a");
    anchor.href = "https://onprem.customer.com/fleet/1/issues/WS-4";

    handler(clickEvent(anchor));
    handler(clickEvent(anchor)); // still pending: must be a no-op
    handler(clickEvent(anchor)); // ditto
    await flushAsync();
    expect(invoke).toHaveBeenCalledTimes(1);

    resolveAsk({ trusted: true });
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(fallback).not.toHaveBeenCalled();

    // After the prompt resolved the in-flight guard is released: a later
    // click prompts again (and the main-process cache makes it cheap).
    handler(clickEvent(anchor));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  });
});
