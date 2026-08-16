import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { INDEX_HTML, reloadShell } from "../reloadShell";

function makeFakeWin(url: string) {
  const win: any = {
    webContents: {
      getURL: vi.fn(() => url),
      reloadIgnoringCache: vi.fn(),
      session: {
        clearCache: vi.fn(() => Promise.resolve()),
      },
    },
    reload: vi.fn(),
    loadFile: vi.fn(() => Promise.resolve()),
  };
  return win as BrowserWindow;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reloadShell", () => {
  it("non-file URL (e.g. IdP page mid-SSO) keeps native reload", () => {
    const win = makeFakeWin("https://idp.example.com/authorize");
    reloadShell(win, false);
    expect(win.reload).toHaveBeenCalledTimes(1);
    expect(win.loadFile).not.toHaveBeenCalled();
  });

  it("non-file URL with ignoreCache uses reloadIgnoringCache, never loadFile", () => {
    const win = makeFakeWin("https://idp.example.com/authorize");
    reloadShell(win, true);
    expect(win.webContents.reloadIgnoringCache).toHaveBeenCalledTimes(1);
    expect(win.loadFile).not.toHaveBeenCalled();
  });

  it("file:// shell URL loads index.html instead of native reload", () => {
    const win = makeFakeWin("file:///E:/octo/build/index.html");
    reloadShell(win, false);
    expect(win.loadFile).toHaveBeenCalledTimes(1);
    expect(win.loadFile).toHaveBeenCalledWith(INDEX_HTML);
    expect(win.reload).not.toHaveBeenCalled();
  });

  it("file:// shell URL with ignoreCache clears cache before loadFile", async () => {
    const win = makeFakeWin("file:///E:/octo/build/index.html");
    reloadShell(win, true);
    expect(win.webContents.session.clearCache).toHaveBeenCalledTimes(1);
    // loadFile is chained onto clearCache's promise.
    await Promise.resolve();
    expect(win.loadFile).toHaveBeenCalledTimes(1);
    expect(win.loadFile).toHaveBeenCalledWith(INDEX_HTML);
    expect(win.webContents.reloadIgnoringCache).not.toHaveBeenCalled();
  });

  it("logs loadFile failures instead of swallowing them", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const win = makeFakeWin("file:///E:/octo/build/index.html");
    win.loadFile = vi.fn(() => Promise.reject(new Error("boom")));
    reloadShell(win, false);
    await Promise.resolve();
    expect(errorSpy).toHaveBeenCalledWith(
      "[reload-shell] loadFile failed:",
      expect.any(Error),
    );
  });
});
