import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../App", () => ({
  default: {
    shared: {
      currentSpaceId: "",
      avatarChannel: vi.fn(() => ""),
    },
    endpoints: {
      showConversation: vi.fn(),
    },
  },
}));

import { notificationUtil } from "../NotificationUtil";
import WKSDK from "wukongimjssdk";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

/** Reset the short-lived focus-query memoization between tests. */
function resetFocusCache() {
  const util = notificationUtil as any;
  util.focusQueryCache = undefined;
  util.focusQueryInFlight = undefined;
}

describe("NotificationUtil.isWindowFocused", () => {
  beforeEach(() => {
    resetFocusCache();
    Object.defineProperty(window, "__POWERED_ELECTRON__", {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    resetFocusCache();
    delete (window as any).electronNotification;
    delete (window as any).__POWERED_ELECTRON__;
    vi.restoreAllMocks();
  });

  it("uses the Electron main-process focus result", async () => {
    const isWindowFocused = vi.fn().mockResolvedValue(false);
    (window as any).electronNotification = { isWindowFocused };

    await expect(notificationUtil.isWindowFocused()).resolves.toBe(false);
    expect(isWindowFocused).toHaveBeenCalledOnce();
  });

  it("memoizes the focus result within the TTL window", async () => {
    const isWindowFocused = vi.fn().mockResolvedValue(true);
    (window as any).electronNotification = { isWindowFocused };

    await expect(notificationUtil.isWindowFocused()).resolves.toBe(true);
    await expect(notificationUtil.isWindowFocused()).resolves.toBe(true);

    // Second call within TTL must reuse the cached value, not re-issue IPC.
    expect(isWindowFocused).toHaveBeenCalledOnce();
  });

  it("shares a single in-flight IPC request across concurrent callers", async () => {
    const pending = deferred<boolean>();
    const isWindowFocused = vi.fn().mockReturnValue(pending.promise);
    (window as any).electronNotification = { isWindowFocused };

    const a = notificationUtil.isWindowFocused();
    const b = notificationUtil.isWindowFocused();
    pending.resolve(true);

    await expect(a).resolves.toBe(true);
    await expect(b).resolves.toBe(true);
    expect(isWindowFocused).toHaveBeenCalledOnce();
  });

  it("falls back to document.hasFocus when IPC fails", async () => {
    (window as any).electronNotification = {
      isWindowFocused: vi.fn().mockRejectedValue(new Error("IPC unavailable")),
    };
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });

    await expect(notificationUtil.isWindowFocused()).resolves.toBe(true);
  });

  it("uses document.hasFocus outside Electron", async () => {
    Object.defineProperty(window, "__POWERED_ELECTRON__", {
      configurable: true,
      value: false,
    });
    const isWindowFocused = vi.fn();
    (window as any).electronNotification = { isWindowFocused };
    vi.spyOn(document, "hasFocus").mockReturnValue(false);

    await expect(notificationUtil.isWindowFocused()).resolves.toBe(false);
    expect(isWindowFocused).not.toHaveBeenCalled();
  });
});

describe("NotificationUtil.isNotificationSupported", () => {
  afterEach(() => {
    delete (window as any).electronNotification;
    delete (window as any).__POWERED_ELECTRON__;
    vi.restoreAllMocks();
  });

  it("supports Electron native notifications without Web Notification permission", () => {
    Object.defineProperty(window, "__POWERED_ELECTRON__", {
      configurable: true,
      value: true,
    });
    (window as any).electronNotification = {
      show: vi.fn(),
    };
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: undefined,
    });

    expect(notificationUtil.isNotificationSupported()).toBe(true);
  });

  it("does not throw when Electron notification creation fails without Web Notification", async () => {
    Object.defineProperty(window, "__POWERED_ELECTRON__", {
      configurable: true,
      value: true,
    });
    (window as any).electronNotification = {
      show: vi.fn().mockResolvedValue(false),
    };
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: undefined,
    });

    await expect(
      (notificationUtil as any).createNotification({
        title: "title",
        body: "body",
      })
    ).resolves.toBeNull();
  });

  it("cleans up the Electron click listener when the notification closes", async () => {
    Object.defineProperty(window, "__POWERED_ELECTRON__", {
      configurable: true,
      value: true,
    });
    const cleanupClickListener = vi.fn();
    (window as any).electronNotification = {
      show: vi.fn().mockResolvedValue(true),
      close: vi.fn().mockResolvedValue(undefined),
      onClicked: vi.fn().mockReturnValue(cleanupClickListener),
    };

    const notification = await (notificationUtil as any).createNotification({
      title: "title",
      body: "body",
      tag: "message-test",
      onClick: vi.fn(),
    });

    notification.close();

    expect(cleanupClickListener).toHaveBeenCalledOnce();
  });

  it("invalidated listener does not fire on click events", async () => {
    Object.defineProperty(window, "__POWERED_ELECTRON__", {
      configurable: true,
      value: true,
    });
    const onClick = vi.fn();
    let capturedCallback: ((data: any) => void) | undefined;
    const cleanupClickListener = vi.fn();
    (window as any).electronNotification = {
      show: vi.fn().mockResolvedValue(true),
      close: vi.fn().mockResolvedValue(undefined),
      onClicked: vi.fn((cb: (data: any) => void) => {
        capturedCallback = cb;
        return cleanupClickListener;
      }),
    };

    const notification = await (notificationUtil as any).createNotification({
      title: "title",
      body: "body",
      tag: "message-dup-test",
      onClick,
    });

    // Dispose the listener (simulates closeMessageNotification disposing before close)
    notification.dispose();

    // Simulate a click event arriving after disposal
    capturedCallback!({ tag: "message-dup-test" });

    expect(onClick).not.toHaveBeenCalled();
    expect(cleanupClickListener).toHaveBeenCalledOnce();
  });
});

describe("NotificationUtil message notification generations", () => {
  afterEach(() => {
    (notificationUtil as any).closeAllNotifications();
    vi.restoreAllMocks();
  });

  it("returns a generation and removes it after the notification is fully idle", () => {
    const util = notificationUtil as any;
    const tag = "message-generation-test";

    util.messageNotificationGenerations.clear();
    util.messageNotificationInFlightCounts.clear();
    util.messageNotifications.clear();
    util.messageNotificationTimeoutIds.clear();

    const generation = util.closeMessageNotification(tag);

    expect(generation).toBe(1);
    expect(util.messageNotificationGenerations.has(tag)).toBe(false);
  });

  it("keeps a generation while a notification request is still in flight", () => {
    const util = notificationUtil as any;
    const tag = "message-generation-in-flight-test";

    util.messageNotificationGenerations.clear();
    util.messageNotificationInFlightCounts.clear();
    util.messageNotifications.clear();
    util.messageNotificationTimeoutIds.clear();
    util.messageNotificationInFlightCounts.set(tag, 1);

    const generation = util.closeMessageNotification(tag);

    expect(generation).toBe(1);
    expect(util.messageNotificationGenerations.get(tag)).toBe(1);

    util.messageNotificationInFlightCounts.delete(tag);
    util.cleanupMessageNotificationGeneration(tag);
    expect(util.messageNotificationGenerations.has(tag)).toBe(false);
  });

  it("disposes a stale async result without closing the newer notification", async () => {
    const util = notificationUtil as any;
    const first = deferred<any>();
    const second = deferred<any>();
    const firstNotification = {
      close: vi.fn(),
      dispose: vi.fn(),
    };
    const secondNotification = {
      close: vi.fn(),
      dispose: vi.fn(),
    };

    vi.spyOn(WKSDK, "shared").mockReturnValue({
      channelManager: { getChannelInfo: () => undefined },
    } as any);
    vi.spyOn(util, "createNotification")
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const message = {
      messageID: "same-message",
      clientMsgNo: "",
      messageSeq: 1,
      channel: { channelID: "channel", channelType: 1 },
      fromUID: "from",
      header: { reddot: true, noPersist: false },
    } as any;

    const firstRequest = notificationUtil.sendMessageNotification(
      message,
      "first"
    );
    await vi.waitFor(() => expect(util.createNotification).toHaveBeenCalledOnce());

    const secondRequest = notificationUtil.sendMessageNotification(
      message,
      "second"
    );
    await vi.waitFor(() =>
      expect(util.createNotification).toHaveBeenCalledTimes(2)
    );

    first.resolve(firstNotification);
    await firstRequest;
    expect(firstNotification.dispose).toHaveBeenCalledOnce();
    expect(firstNotification.close).not.toHaveBeenCalled();

    second.resolve(secondNotification);
    await secondRequest;

    expect(util.messageNotifications.get("message-same-message")).toBe(
      secondNotification
    );
  });

  it("gives distinct tags to messages without a stable identifier", async () => {
    const util = notificationUtil as any;
    util.closeAllNotifications();

    vi.spyOn(WKSDK, "shared").mockReturnValue({
      channelManager: { getChannelInfo: () => undefined },
    } as any);

    const capturedTags: string[] = [];
    vi.spyOn(util, "createNotification").mockImplementation(
      async (options: any) => {
        capturedTags.push(options.tag);
        return { close: vi.fn(), dispose: vi.fn() };
      }
    );

    const makeAnonMessage = () =>
      ({
        messageID: "",
        clientMsgNo: "",
        messageSeq: 0,
        channel: { channelID: "channel", channelType: 1 },
        fromUID: "from",
        header: { reddot: true, noPersist: false },
      }) as any;

    await notificationUtil.sendMessageNotification(makeAnonMessage(), "a");
    await notificationUtil.sendMessageNotification(makeAnonMessage(), "b");

    expect(capturedTags).toHaveLength(2);
    expect(capturedTags[0]).not.toBe(capturedTags[1]);
  });
});

describe("NotificationUtil call notifications", () => {
  afterEach(() => {
    (notificationUtil as any).closeAllNotifications();
    delete (window as any).electronNotification;
    delete (window as any).__POWERED_ELECTRON__;
    vi.restoreAllMocks();
  });

  it("cleans up the previous call listener when replacing a call", async () => {
    Object.defineProperty(window, "__POWERED_ELECTRON__", {
      configurable: true,
      value: true,
    });
    (window as any).electronNotification = { show: vi.fn() };

    const util = notificationUtil as any;
    const first = { close: vi.fn(), dispose: vi.fn() };
    const second = { close: vi.fn(), dispose: vi.fn() };
    vi.spyOn(util, "createNotification")
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    await notificationUtil.sendCallNotification("user-1", {});
    await notificationUtil.sendCallNotification("user-2", {});

    expect(first.dispose).toHaveBeenCalledOnce();
    expect(first.close).toHaveBeenCalledOnce();
    expect(util.callNotification).toBe(second);
  });
});

describe("NotificationUtil.sendGenericNotification", () => {
  afterEach(() => {
    (notificationUtil as any).closeAllNotifications();
    delete (window as any).electronNotification;
    delete (window as any).__POWERED_ELECTRON__;
    vi.restoreAllMocks();
  });

  it("tracks native generic notifications and releases the listener on closeAll", async () => {
    Object.defineProperty(window, "__POWERED_ELECTRON__", {
      configurable: true,
      value: true,
    });
    (window as any).electronNotification = { show: vi.fn() };

    const util = notificationUtil as any;
    // trackGenericNotification wraps close/dispose; keep a spy on the original.
    const disposeSpy = vi.fn();
    const handle = { close: vi.fn(), dispose: disposeSpy };
    vi.spyOn(util, "createNotification").mockResolvedValueOnce(handle);

    await notificationUtil.sendGenericNotification({
      title: "t",
      body: "b",
    });

    expect(util.genericNotifications.size).toBe(1);

    notificationUtil.closeAllNotifications();

    expect(disposeSpy).toHaveBeenCalled();
    expect(util.genericNotifications.size).toBe(0);
  });

  it("untracks a generic notification when the caller closes the handle", async () => {
    Object.defineProperty(window, "__POWERED_ELECTRON__", {
      configurable: true,
      value: true,
    });
    (window as any).electronNotification = { show: vi.fn() };

    const util = notificationUtil as any;
    const handle = { close: vi.fn(), dispose: vi.fn() };
    vi.spyOn(util, "createNotification").mockResolvedValueOnce(handle);

    const result = (await notificationUtil.sendGenericNotification({
      title: "t",
      body: "b",
    })) as any;

    result.close();

    expect(util.genericNotifications.size).toBe(0);
  });
});

describe("NotificationUtil.closeAllNotifications", () => {
  it("clears all internal maps to prevent unbounded growth", () => {
    const util = notificationUtil as any;

    // Seed some entries
    util.messageNotificationGenerations.set("tag-a", 2);
    util.messageNotificationGenerations.set("tag-b", 1);
    util.messageNotificationInFlightCounts.set("tag-a", 1);

    util.closeAllNotifications();

    expect(util.messageNotifications.size).toBe(0);
    expect(util.messageNotificationTimeoutIds.size).toBe(0);
    expect(util.messageNotificationGenerations.size).toBe(0);
    expect(util.messageNotificationInFlightCounts.size).toBe(0);
  });
});
