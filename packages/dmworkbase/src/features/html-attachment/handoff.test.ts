import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  descriptorKey,
  openHtmlAttachment,
  readHtmlPreviewDescriptor,
} from "./handoff";
import {
  configureHtmlAttachmentRuntime,
  storedAttachmentSession,
} from "./runtime";
const session = {
  uid: "u",
  sessionId: "s",
  token: "test-token",
  spaceId: "a",
  apiURL: "/api/v1/",
};
const file = {
  url: "https://store.test/chat/object",
  name: "报告.html",
  extension: "html",
};
describe("new tab handoff", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState(null, "", "/");
    configureHtmlAttachmentRuntime(() => session);
  });
  afterEach(() => vi.restoreAllMocks());
  it("opens synchronously, detaches opener and puts only metadata in the descriptor", () => {
    const saved = new Map<string, string>();
    const target = {
      opener: window,
      sessionStorage: {
        setItem: (key: string, value: string) => saved.set(key, value),
      },
      location: { replace: vi.fn() },
      close: vi.fn(),
    };
    const open = vi
      .spyOn(window, "open")
      .mockReturnValue(target as unknown as Window);
    openHtmlAttachment(file);
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(target.opener).toBeNull();
    const path = target.location.replace.mock.calls[0][0];
    expect(path).toMatch(/\/file-preview#[a-f0-9-]{36}$/);
    expect(path).not.toContain("store.test");
    expect(path).not.toContain(session.token);
    const descriptor = JSON.parse(
      saved.get(descriptorKey(path.split("#")[1]))!
    );
    expect(descriptor.file.name).toBe(file.name);
    expect(JSON.stringify(descriptor)).not.toContain(session.token);
    expect(saved.get("octo.session.sid")).toBe("s");
  });
  it("reports popup denial without fetching or signing", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    expect(() => openHtmlAttachment(file)).toThrow("popupBlocked");
  });
  it("closes an incomplete handoff if storage is unavailable", () => {
    const close = vi.fn();
    vi.spyOn(window, "open").mockReturnValue({
      opener: window,
      close,
      get sessionStorage() {
        throw new Error("denied");
      },
    } as unknown as Window);
    expect(() => openHtmlAttachment(file)).toThrow("popupBlocked");
    expect(close).toHaveBeenCalled();
  });
  it("does not recover an absent descriptor or a different user's bucket", () => {
    expect(readHtmlPreviewDescriptor()).toBeNull();
    sessionStorage.setItem("octo.session.sid", "s");
    sessionStorage.setItem("uids", "u");
    sessionStorage.setItem("tokens", "old");
    localStorage.setItem("uids", "other-user");
    localStorage.setItem("tokens", "new");
    expect(storedAttachmentSession("s", "a", "/api/v1/")).toBeNull();
  });
  it("detects logout even while the new tab retains a copied sessionStorage token", () => {
    sessionStorage.setItem("octo.session.sid", "s");
    sessionStorage.setItem("uids", "u");
    sessionStorage.setItem("tokens", "test-token");
    localStorage.setItem("uids", "u");
    localStorage.setItem("tokens", "test-token");
    expect(storedAttachmentSession("s", "a", "/api/v1/")?.uid).toBe("u");
    localStorage.removeItem("tokens");
    expect(storedAttachmentSession("s", "a", "/api/v1/")).toBeNull();
  });
});
