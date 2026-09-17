import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Howl } from "howler";
import { Channel, type Message } from "wukongimjssdk";
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }));
import BaseModule from "../module";
import WKApp from "../App";
import { quickMuteStore, type QuickMuteState } from "../Components/NavRail/QuickMuteStore";
import { installNotificationProvider, type NotificationDecision, type NotificationPreferencesData } from "../features/notifications";

const defaults: NotificationPreferencesData = {
  version: 1, desktopNotifications: true, soundNotifications: true, quickMuteScope: "all",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("BaseModule host notification consumers", () => {
  let preferences: NotificationPreferencesData;
  let paused: QuickMuteState;
  let dispose: () => void;
  let module: BaseModule;
  let play: ReturnType<typeof vi.fn>;
  const message = {
    channel: new Channel("group-notify", 2), contentType: 1, fromUID: "other",
    content: { contentObj: {} },
  } as unknown as Message;
  const decision = () => (module as unknown as {
    getNotifyDecision(message: Message): Promise<NotificationDecision>;
  }).getNotifyDecision(message);

  beforeEach(() => {
    preferences = { ...defaults };
    paused = { active: false, scope: "sound-and-popup" };
    dispose = installNotificationProvider({ getPreferences: async () => preferences });
    vi.spyOn(quickMuteStore, "getState").mockImplementation(async () => paused);
    WKApp.loginInfo.uid = "me";
    WKApp.shared.currentSpaceId = "";
    WKApp.shared.notificationIsClose = false;
    module = new BaseModule();
    play = vi.fn();
    module.messageTone = { play } as unknown as Howl;
  });
  afterEach(() => { dispose(); vi.restoreAllMocks(); });

  for (const active of [false, true]) {
    for (const quickMuteScope of ["popup", "all"] as const) {
      for (const soundNotifications of [false, true]) {
        it(`message and sound consumer: pause=${active}, scope=${quickMuteScope}, sound=${soundNotifications}`, async () => {
          preferences = { ...defaults, quickMuteScope, soundNotifications };
          paused.active = active;
          const expected = {
            playSound: soundNotifications && (!active || quickMuteScope === "popup"),
            showPopup: !active,
          };
          expect(await decision()).toMatchObject(expected);
          await module.tipsAudio({ allowDuringQuickMute: true });
          expect(play).toHaveBeenCalledTimes(expected.playSound ? 1 : 0);
        });
      }
    }
  }

  it("desktop toggle does not suppress independently enabled message audio", async () => {
    preferences.desktopNotifications = false;
    expect(await decision()).toMatchObject({ playSound: true, showPopup: false });
    await module.tipsAudio();
    expect(play).toHaveBeenCalledOnce();
  });

  it("channel/account allowNotify guards still win over host preferences", async () => {
    WKApp.shared.notificationIsClose = true;
    expect(await decision()).toMatchObject({ playSound: false, showPopup: false });
  });

  it("a rejected provider suppresses both actual consumers", async () => {
    dispose = installNotificationProvider({ getPreferences: async () => { throw new Error("offline"); } });
    expect(await decision()).toMatchObject({ playSound: false, showPopup: false });
    await module.tipsAudio({ allowDuringQuickMute: true });
    expect(play).not.toHaveBeenCalled();
  });

  it("disposal during the final pause await prevents actual playback", async () => {
    const read = deferred<QuickMuteState>();
    const entered = deferred<void>();
    vi.mocked(quickMuteStore.getState).mockImplementation(() => {
      entered.resolve();
      return read.promise;
    });
    const pending = module.tipsAudio({ allowDuringQuickMute: true });
    await entered.promise;
    dispose();
    read.resolve(paused);
    await pending;
    expect(play).not.toHaveBeenCalled();
  });

  it("disposal during the preference await rejects later and future sounds", async () => {
    const read = deferred<NotificationPreferencesData>();
    dispose = installNotificationProvider({ getPreferences: () => read.promise });
    const pending = module.tipsAudio();
    dispose();
    read.resolve(defaults);
    await pending;
    await module.tipsAudio({ allowDuringQuickMute: true });
    expect(play).not.toHaveBeenCalled();
    expect(await decision()).toMatchObject({ playSound: false, showPopup: false });
  });
});
