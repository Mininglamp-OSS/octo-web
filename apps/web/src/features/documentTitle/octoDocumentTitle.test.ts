import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentTitleControllerOptions } from "./DocumentTitleController";

const state = vi.hoisted(() => ({
  options: undefined as DocumentTitleControllerOptions | undefined,
  loggedIn: true,
  menuId: "docs",
  emit: vi.fn(),
  sync: vi.fn(),
}));
vi.mock("@octo/base", () => ({
  WKApp: {
    get currentMenuId() { return state.menuId; },
    loginInfo: { isLogined: () => state.loggedIn },
    mittBus: { emit: state.emit },
  },
  getCurrentImConversationStore: () => ({ ensureSnapshot: state.sync }),
  titleContextStore: {},
}));
vi.mock("./DocumentTitleController", () => ({
  DocumentTitleController: class {
    constructor(options: DocumentTitleControllerOptions) { state.options = options; }
  },
  resolveTitleMenuId: (_path: string, menuId: string) => menuId,
}));

import { createOctoDocumentTitleController } from "./octoDocumentTitle";

beforeEach(() => {
  state.loggedIn = true;
  state.menuId = "docs";
  state.emit.mockReset();
  state.sync.mockReset().mockResolvedValue(undefined);
  createOctoDocumentTitleController();
});

describe("document title conversation hydration", () => {
  it("requests the shared store snapshot without becoming another publisher", async () => {
    await state.options?.restoreUnreadState?.();
    expect(state.sync).toHaveBeenCalledWith();
    expect(state.emit).not.toHaveBeenCalled();
  });

  it("leaves errors visible to the title controller without announcing success", async () => {
    state.sync.mockRejectedValueOnce(new Error("offline"));
    await expect(state.options?.restoreUnreadState?.()).rejects.toThrow("offline");
    expect(state.emit).not.toHaveBeenCalled();
  });

  it.each(["logged-out", "chat"])("leaves %s hydration to its original owner", async (mode) => {
    if (mode === "logged-out") state.loggedIn = false;
    else state.menuId = "chat";
    await state.options?.restoreUnreadState?.();
    expect(state.sync).not.toHaveBeenCalled();
    expect(state.emit).not.toHaveBeenCalled();
  });
});
