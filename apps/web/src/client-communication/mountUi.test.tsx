// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountCommunicationUi } from "./mountUi";
import type { CommunicationBootstrap, OctoBuddyCommunicationBridge } from "./hostBridge";

const f = vi.hoisted(() => ({
  render: vi.fn(), unmount: vi.fn(), presentationDispose: vi.fn(),
  documentDispose: vi.fn(), fileDispose: vi.fn(),
  documentInstall: vi.fn(), fileInstall: vi.fn(),
}));
vi.mock("react-dom/client", () => ({
  createRoot: () => ({ render: f.render, unmount: f.unmount }),
}));
vi.mock("@octo/base", () => ({
  I18nProvider: () => null,
  WKApp: { shared: { currentSpaceId: "current-space" }, config: { appVersion: "test" } },
}));
vi.mock("./CommunicationShell", () => ({ CommunicationShell: () => null }));
vi.mock("./desktopPresentationLifecycle", () => ({
  installDesktopPresentationLifecycle: () => ({
    available: Promise.resolve(), reportReady: vi.fn(), dispose: f.presentationDispose,
  }),
}));
vi.mock("./documentPreview", () => ({ installHostDocumentPreview: f.documentInstall }));
vi.mock("./filePreview", () => ({ installHostFilePreview: f.fileInstall }));

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="root"></div>';
  f.documentInstall.mockReturnValue(f.documentDispose);
  f.fileInstall.mockReturnValue(f.fileDispose);
});
afterEach(() => { document.body.innerHTML = ""; });
const host = {} as OctoBuddyCommunicationBridge;
const bootstrap = { initialPage: "chat" } as CommunicationBootstrap;

describe("communication preview UI ownership", () => {
  it("installs and disposes both preview bridges with the legacy UI", async () => {
    const dispose = await mountCommunicationUi(host, bootstrap);
    expect(f.documentInstall).toHaveBeenCalledWith(host, "current-space");
    expect(f.fileInstall).toHaveBeenCalledWith(host, "current-space");
    dispose();
    expect(f.unmount).toHaveBeenCalledOnce();
    expect(f.documentDispose).toHaveBeenCalledOnce();
    expect(f.fileDispose).toHaveBeenCalledOnce();
    expect(f.presentationDispose).toHaveBeenCalledOnce();
  });

  it("does not replace the background owner's scoped document bridge", async () => {
    const dispose = await mountCommunicationUi(host, bootstrap, { runtimeOwned: true });
    expect(f.documentInstall).not.toHaveBeenCalled();
    expect(f.fileInstall).toHaveBeenCalledOnce();
    dispose();
    expect(f.fileDispose).toHaveBeenCalledOnce();
  });

  it("does not install preview bridges for a cancelled lazy UI mount", async () => {
    await mountCommunicationUi(host, bootstrap, { isActive: () => false });
    expect(f.fileInstall).not.toHaveBeenCalled();
    expect(f.documentInstall).not.toHaveBeenCalled();
    expect(f.render).not.toHaveBeenCalled();
    expect(f.presentationDispose).toHaveBeenCalledOnce();
  });
});
