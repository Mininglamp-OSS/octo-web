import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Channel, ChannelTypeGroup } from "wukongimjssdk";

const mocks = vi.hoisted(() => ({
  avatarChannel: vi.fn(
    (channel: { channelID: string }) =>
      `https://example.test/${channel.channelID}.png`
  ),
  on: vi.fn(),
  off: vi.fn(),
  getCurrentImChannelInfo: vi.fn(),
}));

vi.mock("../../../App", () => ({
  default: {
    mittBus: {
      on: mocks.on,
      off: mocks.off,
    },
    shared: {
      avatarChannel: mocks.avatarChannel,
    },
  },
}));

vi.mock("../../../im-runtime/currentChannelRuntime", () => ({
  getCurrentImChannelInfo: mocks.getCurrentImChannelInfo,
}));

import WKAvatar from "../index";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("--octo-ui-avatar-size-16");
  document.querySelector("[data-wk-avatar-test-styles]")?.remove();
});

describe("WKAvatar composition", () => {
  it("keeps the legacy class and caller-controlled size on the Avatar shell", () => {
    const { container } = render(
      <WKAvatar
        src="https://example.test/candice.png"
        style={{ width: 24, height: 24 }}
      />
    );

    const shell = container.querySelector<HTMLElement>(".wk-avatar");
    const image = shell?.querySelector<HTMLImageElement>("img");

    expect(shell?.tagName).toBe("SPAN");
    expect(shell).toHaveClass(
      "octo-ui-avatar",
      "octo-ui-avatar--size-40",
      "wk-avatar"
    );
    expect(shell).toHaveStyle({ width: "24px", height: "24px" });
    expect(image?.src).toBe("https://example.test/candice.png");
    expect(image?.getAttribute("loading")).toBe("eager");
    expect(image?.getAttribute("decoding")).toBe("async");
  });

  it("keeps the group identity class without applying group fallback styling", () => {
    const { container } = render(
      <WKAvatar channel={new Channel("group-1", ChannelTypeGroup)} />
    );

    const shell = container.querySelector<HTMLElement>(".wk-avatar");
    expect(shell).toHaveClass("wk-avatar-group", "octo-ui-avatar--person");
    expect(shell).not.toHaveClass("octo-ui-avatar--group");
  });

  it("forwards an explicit primitive size to the Avatar shell", () => {
    const styles = document.createElement("style");
    styles.dataset.wkAvatarTestStyles = "true";
    styles.textContent = [
      readFileSync(
        resolve(process.cwd(), "../octo-ui/src/components/Avatar/index.css"),
        "utf8"
      ),
      readFileSync(
        resolve(process.cwd(), "src/Components/WKAvatar/index.css"),
        "utf8"
      ),
    ].join("\n");
    document.head.append(styles);
    document.documentElement.style.setProperty(
      "--octo-ui-avatar-size-16",
      "16px"
    );
    const { container } = render(
      <WKAvatar src="https://example.test/candice.png" size={16} />
    );

    const shell = container.querySelector<HTMLElement>(".wk-avatar");
    expect(shell).toHaveClass(
      "octo-ui-avatar--size-16"
    );
    const computedStyle = getComputedStyle(shell as HTMLElement);
    expect(computedStyle.width).toBe("var(--octo-ui-avatar-size)");
    expect(computedStyle.height).toBe("var(--octo-ui-avatar-size)");
    expect(computedStyle.getPropertyValue("--octo-ui-avatar-size")).toBe(
      "var(--octo-ui-avatar-size-16)"
    );
    expect(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--octo-ui-avatar-size-16"
      )
    ).toBe("16px");
  });

  it("keeps the legacy placeholder when the image fails", async () => {
    const { container } = render(
      <WKAvatar src="https://example.test/broken.png" />
    );

    fireEvent.error(
      container.querySelector(".wk-avatar img") as HTMLImageElement
    );

    await waitFor(() => {
      const fallback =
        container.querySelector<HTMLImageElement>(".wk-avatar img");
      expect(fallback?.src).toContain("data:image/svg+xml");
    });
  });

  it("retries the business avatar URL after a failure and refresh event", async () => {
    const channel = new Channel("group-1", ChannelTypeGroup);
    const { container } = render(<WKAvatar channel={channel} />);
    const businessSrc = "https://example.test/group-1.png";

    fireEvent.error(
      container.querySelector(".wk-avatar img") as HTMLImageElement
    );
    await waitFor(() => {
      expect(
        container.querySelector<HTMLImageElement>(".wk-avatar img")?.src
      ).toContain("data:image/svg+xml");
    });

    const refreshHandler = mocks.on.mock.calls.find(
      ([eventName]) => eventName === "channel-avatar-changed"
    )?.[1] as
      | ((payload: { channelID: string; channelType: number }) => void)
      | undefined;

    act(() => {
      refreshHandler?.({
        channelID: channel.channelID,
        channelType: channel.channelType,
      });
    });

    await waitFor(() => {
      expect(
        container.querySelector<HTMLImageElement>(".wk-avatar img")?.src
      ).toBe(businessSrc);
    });
  });

  it("keeps custom scroll-root lazy loading before assigning the real src", async () => {
    let callback: IntersectionObserverCallback | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();

    class IntersectionObserverMock {
      constructor(nextCallback: IntersectionObserverCallback) {
        callback = nextCallback;
      }

      observe = observe;
      disconnect = disconnect;
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
      root = null;
      rootMargin = "";
      thresholds = [0];
    }

    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);

    const { container } = render(
      <WKAvatar src="https://example.test/lazy.png" lazy />
    );
    const shell = container.querySelector<HTMLElement>(".wk-avatar");

    expect(observe).toHaveBeenCalledWith(shell);
    expect(
      container.querySelector<HTMLImageElement>(".wk-avatar img")?.src
    ).not.toBe("https://example.test/lazy.png");

    act(() => {
      callback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    await waitFor(() => {
      expect(
        container.querySelector<HTMLImageElement>(".wk-avatar img")?.src
      ).toBe("https://example.test/lazy.png");
    });
    expect(disconnect).toHaveBeenCalled();
  });
});
