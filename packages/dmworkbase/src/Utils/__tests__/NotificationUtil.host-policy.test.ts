import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../App", () => ({
  default: { shared: { avatarChannel: () => "" }, endpoints: { showConversation: vi.fn() } },
}));

let policy: typeof import("../../features/notifications/notificationPolicy");
let createNotification: (options: { title: string; body: string }) => Promise<unknown>;
const nativeShow = vi.fn();
const browserShow = vi.fn();
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  policy = await import("../../features/notifications/notificationPolicy");
  const { notificationUtil } = await import("../NotificationUtil");
  createNotification = (notificationUtil as unknown as {
    createNotification: typeof createNotification;
  }).createNotification.bind(notificationUtil);
  vi.stubGlobal("__POWERED_ELECTRON__", true);
  vi.stubGlobal("electronNotification", { show: nativeShow });
  vi.stubGlobal("Notification", class {
    static permission = "granted";
    constructor() { browserShow(); }
  });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Client native notification rejection", () => {
  for (const rejection of ["false", "error"]) {
    it(`cannot bypass host policy using Web Notification after ${rejection}`, async () => {
      policy.installNotificationProvider({ getPreferences: async () => ({
        version: 1, desktopNotifications: false, soundNotifications: false, quickMuteScope: "all",
      }) });
      if (rejection === "false") nativeShow.mockResolvedValue(false);
      else nativeShow.mockRejectedValue(new Error("disposed"));
      expect(await createNotification({ title: "fixture", body: "fixture" })).toBeNull();
      expect(nativeShow).toHaveBeenCalledOnce();
      expect(browserShow).not.toHaveBeenCalled();
    });
  }
  it("retains standalone desktop fallback when no Client provider exists", async () => {
    nativeShow.mockResolvedValue(false);
    expect(await createNotification({ title: "fixture", body: "fixture" })).not.toBeNull();
    expect(browserShow).toHaveBeenCalledOnce();
  });
});
