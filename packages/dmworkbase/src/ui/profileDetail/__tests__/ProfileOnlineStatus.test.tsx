import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfileOnlineStatus, { getProfileOnlineStatus } from "../ProfileOnlineStatus";

describe("getProfileOnlineStatus", () => {
  const now = new Date("2026-07-29T12:00:00").getTime();
  const tr = (key: string, options?: { values?: Record<string, unknown> }) => {
    const messages: Record<string, string> = {
      "base.profileOnlineStatus.online": "在线",
      "base.profileOnlineStatus.offline": "离线",
      "base.profileOnlineStatus.justOffline": "刚刚离线",
      "base.profileOnlineStatus.minutesAgo": `离线 ${options?.values?.count} 分钟前`,
      "base.profileOnlineStatus.hoursAgo": `离线 ${options?.values?.count} 小时前`,
      "base.profileOnlineStatus.lastOnline": `上次在线 ${options?.values?.time}`,
    };
    return messages[key] || key;
  };

  it("shows online before historical offline time", () => {
    expect(
      getProfileOnlineStatus({ online: true, lastOffline: now / 1000 - 86400 }, now, tr as any)
    ).toEqual({ tone: "online", text: "在线" });
  });

  it("formats recently offline ranges", () => {
    expect(
      getProfileOnlineStatus({ online: false, lastOffline: now / 1000 - 30, orgData: { online: 0 } }, now, tr as any)?.text
    ).toBe("刚刚离线");
    expect(
      getProfileOnlineStatus({ online: false, lastOffline: now / 1000 - 3 * 60 - 20, orgData: { online: 0 } }, now, tr as any)?.text
    ).toBe("离线 3 分钟前");
    expect(
      getProfileOnlineStatus({ online: false, lastOffline: now / 1000 - 23 * 3600 - 59, orgData: { online: 0 } }, now, tr as any)?.text
    ).toBe("离线 23 小时前");
  });

  it("formats last online time at and after 24 hours", () => {
    expect(
      getProfileOnlineStatus({ online: false, lastOffline: new Date("2026-07-28T12:00:00").getTime() / 1000, orgData: { online: 0 } }, now, tr as any)?.text
    ).toBe("上次在线 07-28 12:00");
    expect(
      getProfileOnlineStatus({ online: false, lastOffline: new Date("2025-12-30T09:15:00").getTime() / 1000, orgData: { online: 0 } }, now, tr as any)?.text
    ).toBe("上次在线 2025-12-30 09:15");
  });

  it("shows generic offline only when offline is known but time is missing", () => {
    expect(
      getProfileOnlineStatus({ online: false, orgData: { online: 0 } }, now, tr as any)
    ).toEqual({ tone: "offline", text: "离线" });
  });

  it("uses the supplied translator for multilingual text", () => {
    const en = (key: string, options?: { values?: Record<string, unknown> }) => {
      const messages: Record<string, string> = {
        "base.profileOnlineStatus.online": "Online",
        "base.profileOnlineStatus.hoursAgo": `Offline ${options?.values?.count} hr ago`,
      };
      return messages[key] || key;
    };

    expect(getProfileOnlineStatus({ online: true }, now, en as any)?.text).toBe("Online");
    expect(
      getProfileOnlineStatus({ online: false, lastOffline: now / 1000 - 2 * 3600, orgData: { online: 0 } }, now, en as any)?.text
    ).toBe("Offline 2 hr ago");
  });

  it("hides unknown status", () => {
    expect(getProfileOnlineStatus({ online: false }, now, tr as any)).toBeUndefined();
    expect(getProfileOnlineStatus(undefined, now, tr as any)).toBeUndefined();
  });
});

describe("ProfileOnlineStatus", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T12:00:30"));
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    vi.useRealTimers();
  });

  it("renders accessible status text and advances while open", () => {
    act(() => {
      ReactDOM.render(
        <ProfileOnlineStatus channelInfo={{ online: false, lastOffline: new Date("2026-07-29T12:00:00").getTime() / 1000, orgData: { online: 0 } }} />,
        container
      );
    });

    const status = container.querySelector('[role="status"]');
    expect(status?.getAttribute("aria-label")).toBe("刚刚离线");
    expect(status?.textContent).toBe("刚刚离线");

    act(() => {
      vi.setSystemTime(new Date("2026-07-29T12:01:00"));
      vi.advanceTimersByTime(1000);
    });

    expect(container.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe(
      "离线 1 分钟前"
    );
  });
});
