// @vitest-environment jsdom

import React from "react";
import DOMPurify from "dompurify";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageDetail } from "../bridge/types";

const state = vi.hoisted(() => ({
  getMessage: vi.fn(),
  getThread: vi.fn(),
  getRawMessage: vi.fn(),
  sendDraft: vi.fn(),
  restoreNotJunk: vi.fn(),
  emit: vi.fn(),
  wkConfirm: vi.fn(),
  t: vi.fn((key: string) => key),
}));

vi.mock("@octo/base", () => ({
  useI18n: () => ({ t: state.t, locale: "en-US" }),
  wkConfirm: state.wkConfirm,
  WKApp: {
    mittBus: { emit: state.emit },
    routeRight: { pop: vi.fn(), push: vi.fn() },
  },
}));

vi.mock("../Service/MailService", () => ({
  default: {
    getMessage: state.getMessage,
    getThread: state.getThread,
    getMessageDelivery: vi.fn(),
    updateKeywords: vi.fn(),
    restoreNotJunk: state.restoreNotJunk,
    deleteMessage: vi.fn(),
    sendDraft: state.sendDraft,
    getRawMessage: state.getRawMessage,
    downloadAttachment: vi.fn(),
  },
}));

import MessageDetailFeature from "./MessageDetailFeature";

const draft: MessageDetail = {
  id: "E1",
  mailbox: "Drafts",
  subject: "Owner review",
  from: "bot@mail.imocto.cn",
  to: ["customer@example.com"],
  preview: "Please review",
  receivedAt: "2026-08-11T00:00:00Z",
  size: 128,
  keywords: [],
  unread: false,
  bodyText: "Please review",
  attachments: [],
  agentDraft: {
    outcome: "owner_confirmation_required",
    status: "pending_confirmation",
    draftType: "agent_pending_confirmation",
    draftId: "E1",
    draftSubject: "Owner review",
    draftVersion: 1,
  },
};

describe("MessageDetailFeature action errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.getMessage.mockReset();
    state.sendDraft.mockReset();
    state.restoreNotJunk.mockReset();
    state.wkConfirm.mockReset();
    state.getThread.mockReset();
    state.getRawMessage.mockReset();
    state.getMessage.mockResolvedValue(draft);
  });

  afterEach(() => cleanup());

  it("shows a failed Draft send after the message has loaded", async () => {
    state.sendDraft.mockRejectedValue({ msg: "send failed" });

    render(
      <MessageDetailFeature
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        messageId="E1"
        mailboxRole="drafts"
      />
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "mail.actions.sendDraft" })
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "send failed"
    );
    await waitFor(() => expect(state.sendDraft).toHaveBeenCalledTimes(1));
  });

  it("offers an owner-confirmed restore action only in Junk", async () => {
    const junkMessage: MessageDetail = {
      ...draft,
      mailbox: "Junk",
      from: "sender@example.com",
      agentDraft: undefined,
    };
    state.getMessage.mockResolvedValue(junkMessage);
    state.restoreNotJunk.mockResolvedValue({
      updated: "E1",
      senderAddress: "sender@example.com",
    });
    const onRestoredFromJunk = vi.fn();

    render(
      <MessageDetailFeature
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        messageId="E1"
        mailboxRole="junk"
        embedded
        onRestoredFromJunk={onRestoredFromJunk}
      />
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "mail.actions.notJunk" })
    );
    expect(state.restoreNotJunk).not.toHaveBeenCalled();
    expect(state.wkConfirm).toHaveBeenCalledTimes(1);
    const confirmation = state.wkConfirm.mock.calls[0][0];
    expect(confirmation.title).toBe("mail.confirm.notJunkTitle");

    await confirmation.onOk();

    expect(state.restoreNotJunk).toHaveBeenCalledWith("42", "E1");
    expect(onRestoredFromJunk).toHaveBeenCalledTimes(1);
    expect(state.emit).toHaveBeenCalledWith("mail-refresh");
  });

  it("keeps the Junk message when restoring it fails", async () => {
    const failure = { msg: "restore failed" };
    state.getMessage.mockResolvedValue({
      ...draft,
      mailbox: "Junk",
      from: "sender@example.com",
      agentDraft: undefined,
    });
    state.restoreNotJunk.mockRejectedValue(failure);
    const onRestoredFromJunk = vi.fn();

    render(
      <MessageDetailFeature
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        messageId="E1"
        mailboxRole="junk"
        embedded
        onRestoredFromJunk={onRestoredFromJunk}
      />
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "mail.actions.notJunk" })
    );
    const confirmation = state.wkConfirm.mock.calls[0][0];

    await act(async () => {
      await expect(confirmation.onOk()).rejects.toBe(failure);
    });

    expect(await screen.findByText("Owner review")).toBeTruthy();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "restore failed"
    );
    expect(onRestoredFromJunk).not.toHaveBeenCalled();
    expect(state.emit).not.toHaveBeenCalledWith("mail-refresh");
  });

  it("does not show the restore action outside Junk", async () => {
    state.getMessage.mockResolvedValue({ ...draft, agentDraft: undefined });

    render(
      <MessageDetailFeature
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        messageId="E1"
        mailboxRole="inbox"
      />
    );

    await screen.findByText("Owner review");
    expect(
      screen.queryByRole("button", { name: "mail.actions.notJunk" })
    ).toBeNull();
  });

  it("sends the explicit Agent Draft id instead of the message id", async () => {
    state.getMessage.mockResolvedValue({
      ...draft,
      id: "message-E1",
      agentDraft: {
        ...draft.agentDraft!,
        draftId: "draft-E1",
      },
    });
    state.sendDraft.mockResolvedValue({
      submissionIds: ["S1"],
      messageId: "E2",
    });

    render(
      <MessageDetailFeature
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        messageId="message-E1"
        mailboxRole="drafts"
      />
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "mail.actions.sendDraft" })
    );

    await waitFor(() =>
      expect(state.sendDraft).toHaveBeenCalledWith("42", "draft-E1", 1)
    );
  });

  it("keeps the original Draft sendable but blocks editing a truncated attachment list", async () => {
    state.getMessage.mockResolvedValue({
      ...draft,
      attachmentsTruncated: true,
    });

    render(
      <MessageDetailFeature
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        messageId="E1"
        mailboxRole="drafts"
      />
    );

    expect(
      (await screen.findByRole("button", {
        name: "mail.actions.editDraft",
      })) as HTMLButtonElement
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", {
        name: "mail.actions.sendDraft",
      }) as HTMLButtonElement
    ).toHaveProperty("disabled", false);
  });

  it("shows a raw-message download for an oversized HTML body", async () => {
    state.getMessage.mockResolvedValue({
      ...draft,
      bodyTruncated: true,
    });
    state.getRawMessage.mockResolvedValue(new Blob(["raw message"]));

    render(
      <MessageDetailFeature
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        messageId="E1"
        mailboxRole="drafts"
      />
    );

    expect(await screen.findByText("mail.reader.bodyTruncated")).toBeTruthy();
    const downloadButtons = screen.getAllByRole("button", {
      name: "mail.actions.downloadRaw",
    });
    fireEvent.click(downloadButtons.at(-1)!);
    await waitFor(() =>
      expect(state.getRawMessage).toHaveBeenCalledWith("42", "E1")
    );
  });

  it("keeps the current message when one thread member fails to load", async () => {
    state.getMessage
      .mockResolvedValueOnce({ ...draft, threadId: "T1" })
      .mockRejectedValueOnce(new Error("member unavailable"));
    state.getThread.mockResolvedValue({
      id: "T1",
      messages: [
        { ...draft, id: "E1" },
        { ...draft, id: "E2" },
      ],
    });

    render(
      <MessageDetailFeature
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        messageId="E1"
        mailboxRole="drafts"
      />
    );

    expect(await screen.findByText("Owner review")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(state.getMessage).toHaveBeenCalledTimes(2);
  });

  it("renders an available HTML body in an isolated frame", async () => {
    state.getMessage.mockResolvedValue({
      ...draft,
      bodyText: "Plain fallback",
      bodyHtml:
        '<html lang="ar" dir="rtl"><head><style>body.invoice .formatted-body{color:purple}</style></head><body class="invoice" dir="rtl" style="background:#123456"><section class="formatted-body"><strong>HTML body</strong><a id="safe-link" href="https://example.com/invoice">Invoice</a><a id="unsafe-link" href="javascript:alert(1)">Unsafe</a><svg><a id="svg-link" xlink:href="https://example.com/svg-link"><text>SVG link</text></a><a id="unsafe-svg-link" xlink:href="javascript:alert(1)"><text>Unsafe SVG link</text></a></svg><map name="links"><area href="https://example.com/phish"></map></section><script>window.top.location="https://example.com"</script></body></html>',
    });

    render(
      <MessageDetailFeature
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        messageId="E1"
        mailboxRole="drafts"
      />
    );

    const frame = await screen.findByTitle("mail.reader.htmlBody");
    expect(frame.getAttribute("sandbox")).toBe(
      "allow-same-origin allow-popups allow-popups-to-escape-sandbox"
    );
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.getAttribute("srcdoc")).toContain("HTML body");
    expect(frame.getAttribute("srcdoc")).not.toContain("<script>");
    const source = new DOMParser().parseFromString(
      frame.getAttribute("srcdoc") || "",
      "text/html"
    );
    expect(source.querySelector("base")?.getAttribute("href")).toBe(
      "about:blank"
    );
    expect(source.querySelector("base")?.getAttribute("target")).toBe("_blank");
    expect(
      source
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute("content")
    ).toBe(
      "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:"
    );
    const defaultStyle = source.querySelector("style")?.textContent || "";
    expect(defaultStyle).toContain("color-scheme:only light");
    expect(defaultStyle).toContain("background:Canvas");
    expect(
      Array.from(source.querySelectorAll("style"))
        .map((style) => style.textContent)
        .join("\n")
    ).toContain("body.invoice .formatted-body{color:purple}");
    expect(source.documentElement.getAttribute("lang")).toBe("ar");
    expect(source.documentElement.getAttribute("dir")).toBe("rtl");
    expect(source.body.getAttribute("class")).toBe("invoice");
    expect(source.body.getAttribute("dir")).toBe("rtl");
    expect(source.body.getAttribute("style")).toContain("background:#123456");
    expect(source.querySelector("#safe-link")?.getAttribute("target")).toBe(
      "_blank"
    );
    expect(source.querySelector("#safe-link")?.getAttribute("rel")).toBe(
      "noopener noreferrer"
    );
    expect(source.querySelector("#unsafe-link")?.hasAttribute("href")).toBe(
      false
    );
    expect(source.querySelector("#svg-link")?.getAttribute("href")).toBe(
      "https://example.com/svg-link"
    );
    expect(source.querySelector("#svg-link")?.hasAttribute("xlink:href")).toBe(
      false
    );
    expect(source.querySelector("#svg-link")?.getAttribute("target")).toBe(
      "_blank"
    );
    expect(source.querySelector("#svg-link")?.getAttribute("rel")).toBe(
      "noopener noreferrer"
    );
    expect(source.querySelector("#unsafe-svg-link")?.hasAttribute("href")).toBe(
      false
    );
    expect(
      source.querySelector("#unsafe-svg-link")?.hasAttribute("xlink:href")
    ).toBe(false);
    expect(source.querySelector("map, area")).toBeNull();
    expect(screen.queryByText("Plain fallback")).toBeNull();
  });

  it.each([
    ["wrapper-only HTML", "<html><body></body></html>"],
    ["empty element HTML", "<div></div>"],
  ])("falls back to text for %s", async (_name, bodyHtml) => {
    state.getMessage.mockResolvedValue({
      ...draft,
      bodyText: "Plain fallback",
      bodyHtml,
    });

    render(
      <MessageDetailFeature
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        messageId="E1"
        mailboxRole="drafts"
      />
    );

    expect(await screen.findByText("Plain fallback")).toBeTruthy();
    expect(screen.queryByTitle("mail.reader.htmlBody")).toBeNull();
  });

  it.each([
    ["remote image", '<img src="https://example.com/hero.png">'],
    ["CID image", '<img src="cid:image001@example.com">'],
    ["remote video", '<video src="https://example.com/movie.mp4"></video>'],
  ])("falls back to text for a blocked %s", async (_name, bodyHtml) => {
    state.getMessage.mockResolvedValue({
      ...draft,
      bodyText: "Plain fallback",
      bodyHtml,
    });

    render(
      <MessageDetailFeature
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        messageId="E1"
        mailboxRole="drafts"
      />
    );

    expect(await screen.findByText("Plain fallback")).toBeTruthy();
    expect(screen.queryByTitle("mail.reader.htmlBody")).toBeNull();
  });

  it.each([
    [
      "opacity-hidden preheader",
      '<div style="opacity:0">Hidden preheader</div><img src="https://example.com/blocked.png" width="600" height="300">',
    ],
    [
      "zero-size preheader",
      '<div style="font-size:0;line-height:0">Hidden preheader</div><img src="https://example.com/blocked.png" width="600" height="300">',
    ],
    [
      "clipped transparent preheader",
      '<div style="color:transparent;height:0;overflow:hidden">Hidden preheader</div><img src="https://example.com/blocked.png" width="600" height="300">',
    ],
  ])("falls back to text for a %s", async (_name, bodyHtml) => {
    state.getMessage.mockResolvedValue({
      ...draft,
      bodyText: "Plain fallback",
      bodyHtml,
    });

    render(
      <MessageDetailFeature
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        messageId="E1"
        mailboxRole="drafts"
      />
    );

    const frame = (await screen.findByTitle(
      "mail.reader.htmlBody"
    )) as HTMLIFrameElement;
    Object.defineProperty(frame, "clientWidth", {
      configurable: true,
      value: 800,
    });
    const frameDocument = frame.contentDocument!;
    frameDocument.body.setAttribute("data-octo-mail-body", "");
    frameDocument.body.innerHTML = bodyHtml;
    fireEvent.load(frame);

    expect(await screen.findByText("Plain fallback")).toBeTruthy();
    expect(screen.queryByTitle("mail.reader.htmlBody")).toBeNull();
  });

  it("does not latch the text fallback while the frame is zero-width", async () => {
    let resizeCallback: ResizeObserverCallback | undefined;
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      disconnect() {}
      observe() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    state.getMessage.mockResolvedValue({
      ...draft,
      bodyText: "Plain fallback",
      bodyHtml:
        '<img alt="Inline chart" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">',
    });

    try {
      render(
        <MessageDetailFeature
          mailboxContextId="42"
          mailboxAddress="bot@mail.imocto.cn"
          messageId="E1"
          mailboxRole="drafts"
        />
      );

      const frame = (await screen.findByTitle(
        "mail.reader.htmlBody"
      )) as HTMLIFrameElement;
      let width = 800;
      Object.defineProperty(frame, "clientWidth", {
        configurable: true,
        get: () => width,
      });
      const frameDocument = frame.contentDocument!;
      frameDocument.body.setAttribute("data-octo-mail-body", "");
      frameDocument.body.innerHTML =
        '<img alt="Inline chart" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">';
      const image = frameDocument.querySelector("img")!;
      Object.defineProperties(image, {
        complete: { configurable: true, value: true },
        naturalHeight: { configurable: true, value: 1 },
        naturalWidth: { configurable: true, value: 1 },
      });
      image.getBoundingClientRect = () =>
        ({
          bottom: width > 0 ? 1 : 0,
          height: width > 0 ? 1 : 0,
          left: 0,
          right: width > 0 ? 1 : 0,
          toJSON: () => ({}),
          top: 0,
          width: width > 0 ? 1 : 0,
          x: 0,
          y: 0,
        } as DOMRect);
      fireEvent.load(frame);

      width = 0;
      resizeCallback?.(
        [{ contentRect: { width: 0 } } as ResizeObserverEntry],
        {} as ResizeObserver
      );

      expect(screen.queryByText("Plain fallback")).toBeNull();
      expect(screen.getByTitle("mail.reader.htmlBody")).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("caps the auto-sized HTML body height", async () => {
    state.getMessage.mockResolvedValue({
      ...draft,
      bodyHtml: '<div style="min-height:300vh">HTML body</div>',
    });

    render(
      <MessageDetailFeature
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        messageId="E1"
        mailboxRole="drafts"
      />
    );

    const frame = await screen.findByTitle("mail.reader.htmlBody");
    Object.defineProperty(frame, "clientWidth", {
      configurable: true,
      value: 800,
    });
    const frameDocument = (frame as HTMLIFrameElement).contentDocument;
    expect(frameDocument).toBeTruthy();
    frameDocument!.body.setAttribute("data-octo-mail-body", "");
    frameDocument!.body.innerHTML = "<p>HTML body</p>";
    Object.defineProperty(frameDocument!.documentElement, "scrollHeight", {
      configurable: true,
      value: 60_000,
    });
    Object.defineProperty(frameDocument!.body, "scrollHeight", {
      configurable: true,
      value: 60_000,
    });
    fireEvent.load(frame);

    expect((frame as HTMLIFrameElement).style.height).toBe("20000px");
  });

  it("measures viewport-unit content from a stable baseline", async () => {
    state.getMessage.mockResolvedValue({
      ...draft,
      bodyHtml: '<div style="height:110vh">HTML body</div>',
    });

    render(
      <MessageDetailFeature
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        messageId="E1"
        mailboxRole="drafts"
      />
    );

    const frame = (await screen.findByTitle(
      "mail.reader.htmlBody"
    )) as HTMLIFrameElement;
    Object.defineProperty(frame, "clientWidth", {
      configurable: true,
      value: 800,
    });
    const frameDocument = frame.contentDocument!;
    frameDocument.body.setAttribute("data-octo-mail-body", "");
    frameDocument.body.innerHTML = "<p>HTML body</p>";
    const viewportRelativeHeight = () =>
      Math.round((Number.parseFloat(frame.style.height) || 150) * 1.1);
    Object.defineProperty(frameDocument.documentElement, "scrollHeight", {
      configurable: true,
      get: viewportRelativeHeight,
    });
    Object.defineProperty(frameDocument.body, "scrollHeight", {
      configurable: true,
      get: viewportRelativeHeight,
    });

    fireEvent.load(frame);
    expect(frame.style.height).toBe("88px");
    fireEvent.load(frame);
    expect(frame.style.height).toBe("88px");
  });

  it("caps full-message thread fan-out", async () => {
    state.getMessage.mockImplementation(async (_mailboxId, id) => ({
      ...draft,
      id,
      threadId: "T1",
    }));
    state.getThread.mockResolvedValue({
      id: "T1",
      messages: Array.from({ length: 50 }, (_, index) => ({
        ...draft,
        id: `E${index + 1}`,
      })),
    });

    render(
      <MessageDetailFeature
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        messageId="E1"
        mailboxRole="drafts"
      />
    );

    expect(await screen.findByText("Owner review")).toBeTruthy();
    await waitFor(() => expect(state.getMessage).toHaveBeenCalledTimes(20));
  });

  it("does not resanitize the displayed HTML body when the thread summary expands", async () => {
    const sanitize = vi.spyOn(DOMPurify, "sanitize");
    const htmlDraft = {
      ...draft,
      bodyText: undefined,
      bodyHtml: "<p>Please review</p>",
      threadId: "T1",
    };
    state.getMessage.mockImplementation(async (_mailboxContextId, id) => ({
      ...htmlDraft,
      id,
    }));
    state.getThread.mockResolvedValue({
      id: "T1",
      messages: [
        { ...htmlDraft, id: "E1" },
        { ...htmlDraft, id: "E2" },
      ],
    });

    render(
      <MessageDetailFeature
        mailboxContextId="42"
        mailboxAddress="bot@mail.imocto.cn"
        messageId="E1"
        mailboxRole="drafts"
      />
    );

    await screen.findByText("Owner review");
    await waitFor(() => expect(sanitize).toHaveBeenCalledTimes(1));
    fireEvent.click(
      screen.getByRole("button", { name: /mail.reader.threadCount/ })
    );
    expect(sanitize).toHaveBeenCalledTimes(1);
  });
});
