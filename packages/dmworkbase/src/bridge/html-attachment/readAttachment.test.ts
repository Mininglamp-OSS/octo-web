import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  HTML_BYTE_LIMIT,
  loadHtmlAttachment,
  readBoundedHtml,
} from "./readAttachment";
import {
  configureHtmlAttachmentRuntime,
  currentAttachmentSession,
} from "../../features/html-attachment/runtime";
import { downloadHtmlAttachment } from "./downloadAttachment";

const signer = vi.hoisted(() => vi.fn());
vi.mock("../../Service/AttachmentFileService", () => ({
  default: { getDownloadLink: signer },
}));
const session = {
  uid: "u",
  token: "test-token",
  sessionId: "s",
  spaceId: "a",
  apiURL: "/api/v1/",
};
const file = {
  url: "https://store.test/chat/id",
  name: "报告.html",
  extension: "html",
};

describe("bounded original HTML bytes", () => {
  beforeEach(() => {
    configureHtmlAttachmentRuntime(() => session);
    signer.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it("allows a fresh preview attempt after a signing 401 without resetting the runtime", async () => {
    const proxyFile = { ...file, url: "/file/chat/id" };
    signer.mockRejectedValueOnce({ status: 401 });
    const fetch = vi.fn().mockResolvedValue(new Response("<p>recovered</p>"));
    vi.stubGlobal("fetch", fetch);

    await expect(
      loadHtmlAttachment(proxyFile, session, new AbortController().signal)
    ).rejects.toMatchObject({ code: "downloadFailed" });
    expect(signer).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(currentAttachmentSession()).toEqual(session);

    signer.mockResolvedValueOnce("https://store.test/chat/id?fresh=1");
    const bytes = await loadHtmlAttachment(
      proxyFile,
      session,
      new AbortController().signal
    );
    expect(Array.from(bytes)).toEqual(
      Array.from(new TextEncoder().encode("<p>recovered</p>"))
    );
    expect(signer).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, HTML_BYTE_LIMIT + 1])(
    "fails only the current download on 401 and preserves filename on retry (size %s)",
    async (size) => {
      const proxyFile = { ...file, url: "/file/chat/id", size };
      signer.mockRejectedValueOnce({ status: 401 });
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
      const fetch = vi.fn().mockRejectedValue(new Error("unreadable storage"));
      vi.stubGlobal("fetch", fetch);

      await expect(
        downloadHtmlAttachment(proxyFile, new AbortController().signal)
      ).rejects.toMatchObject({ code: "downloadFailed" });
      expect(signer).toHaveBeenCalledTimes(1);
      expect(click).not.toHaveBeenCalled();
      expect(currentAttachmentSession()).toEqual(session);

      signer.mockResolvedValue("https://store.test/chat/id?download=1");
      await downloadHtmlAttachment(proxyFile, new AbortController().signal);
      expect(click).toHaveBeenCalledTimes(1);
      const anchor = click.mock.instances[0] as HTMLAnchorElement;
      expect(anchor.download).toBe(file.name);
      expect(anchor.href).toBe("https://store.test/chat/id?download=1");
    }
  );
  it.each([null, { ...session, token: "new-token" }])(
    "still rejects a captured session changed during a signing failure: %j",
    async (nextSession) => {
      let live: typeof session | null = session;
      configureHtmlAttachmentRuntime(() => live);
      signer.mockImplementationOnce(async () => {
        live = nextSession;
        throw { status: 401 };
      });
      await expect(
        loadHtmlAttachment(
          { ...file, url: "/file/chat/id" },
          session,
          new AbortController().signal
        )
      ).rejects.toMatchObject({ code: "expired" });
      expect(signer).toHaveBeenCalledTimes(1);
    }
  );
  it("retains BOM, CRLF and invalid UTF-8 bytes verbatim", async () => {
    const source = new Uint8Array([239, 187, 191, 60, 112, 62, 13, 10, 255]);
    const fetch = vi.fn().mockResolvedValue(new Response(source));
    vi.stubGlobal("fetch", fetch);
    expect(
      await loadHtmlAttachment(file, session, new AbortController().signal)
    ).toEqual(source);
    expect(fetch.mock.calls[0][1]).toEqual(
      expect.objectContaining({ credentials: "omit" })
    );
    expect(fetch.mock.calls[0][1].headers).toBeUndefined();
    expect(signer).not.toHaveBeenCalled();
  });
  it("does not fetch known oversized files", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      loadHtmlAttachment(
        { ...file, size: HTML_BYTE_LIMIT + 1 },
        session,
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: "tooLarge" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("cancels a lying/unknown length stream at the actual byte cap", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(HTML_BYTE_LIMIT));
        controller.enqueue(new Uint8Array(1));
      },
      cancel,
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(stream, { headers: { "Content-Length": "1" } })
        )
    );
    await expect(
      readBoundedHtml(file.url, new AbortController().signal)
    ).rejects.toMatchObject({ code: "tooLarge" });
    expect(cancel).toHaveBeenCalled();
  });
  it("rejects an oversized response before consuming its stream", async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new ReadableStream({ cancel }), {
          headers: { "Content-Length": String(HTML_BYTE_LIMIT + 1) },
        })
      )
    );
    await expect(
      readBoundedHtml(file.url, new AbortController().signal)
    ).rejects.toMatchObject({ code: "tooLarge" });
    expect(cancel).toHaveBeenCalled();
  });
  it("resolves a same-origin proxy via signing instead of fetching SPA HTML", async () => {
    signer.mockResolvedValue("https://store.test/chat/id?fresh=1");
    const fetch = vi.fn().mockResolvedValue(new Response("<p>file</p>"));
    vi.stubGlobal("fetch", fetch);
    await loadHtmlAttachment(
      { ...file, url: "/file/chat/id", sourceUrl: "file/preview/chat/id" },
      session,
      new AbortController().signal
    );
    expect(signer).toHaveBeenCalledWith(
      "chat/id",
      "报告.html",
      "a",
      expect.anything()
    );
    expect(fetch.mock.calls[0][0]).toBe("https://store.test/chat/id?fresh=1");
  });
  it("refreshes a failed storage URL only once", async () => {
    signer.mockResolvedValue("https://store.test/chat/id?fresh=1");
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      loadHtmlAttachment(file, session, new AbortController().signal)
    ).rejects.toThrow();
    expect(signer).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not retry a cancelled read", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError"))
    );
    await expect(
      loadHtmlAttachment(file, session, controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(signer).not.toHaveBeenCalled();
  });
  it("times out a stalled network request", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError"))
            );
          })
      )
    );
    try {
      const pending = expect(
        readBoundedHtml(file.url, new AbortController().signal)
      ).rejects.toMatchObject({ code: "loadFailed" });
      await vi.advanceTimersByTimeAsync(30_000);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });
});
