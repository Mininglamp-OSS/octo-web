import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOM from "react-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { act, Simulate } from "react-dom/test-utils";
import { i18n } from "@octo/base/src/i18n/instance";

const { apiFetchJsonMock } = vi.hoisted(() => ({
  apiFetchJsonMock: vi.fn(),
}));

vi.mock("@douyinfe/semi-ui", () => ({
  Spin: ({ "aria-label": ariaLabel }: { "aria-label"?: string }) =>
    React.createElement("span", {
      "data-spin": "true",
      "aria-label": ariaLabel,
    }),
  Popover: ({
    children,
    position,
    trigger,
    visible,
    onVisibleChange,
    contentClassName,
    arrowStyle,
    style,
  }: {
    children: React.ReactNode;
    position?: string;
    trigger?: string;
    visible?: boolean;
    onVisibleChange?: (visible: boolean) => void;
    contentClassName?: string;
    arrowStyle?: { backgroundColor?: string; borderColor?: string };
    style?: React.CSSProperties;
  }) =>
    React.createElement(
      "span",
      {
        "data-position": position,
        "data-trigger": trigger,
        "data-visible": visible ? "true" : "false",
        "data-content-class": contentClassName,
        "data-arrow-background": arrowStyle?.backgroundColor,
        "data-arrow-border": arrowStyle?.borderColor,
        "data-wrapper-background": style?.backgroundColor,
        "data-wrapper-shadow": style?.boxShadow,
        "data-wrapper-padding": style?.padding,
        onMouseEnter: () => onVisibleChange?.(true),
        onMouseLeave: () => onVisibleChange?.(false),
      },
      children
    ),
}));

vi.mock("@douyinfe/semi-icons", () => ({
  IconGithubLogo: () =>
    React.createElement("span", {
      "data-icon": "github",
      "aria-hidden": "true",
    }),
}));

vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value }: { value: string }) =>
    React.createElement("svg", { "data-qr-value": value }),
}));

type MockWKButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: React.ReactNode;
  iconOnly?: boolean;
  variant?: string;
  size?: string;
};

vi.mock("@octo/base", () => ({
  apiFetchJson: apiFetchJsonMock,
  WKApp: {
    apiClient: {
      config: { apiURL: "/api/v1/" },
    },
  },
  WKButton: ({ children, icon, iconOnly, ...props }: MockWKButtonProps) =>
    React.createElement(
      "button",
      {
        ...props,
        className: "wk-btn",
        "data-icon-only": iconOnly ? "true" : undefined,
      },
      icon,
      children
    ),
}));

import {
  ANDROID_RELEASES_URL,
  ANDROID_UPDATER_PATH,
  AndroidDownloadButton,
  AndroidDownloadPopoverContent,
  openAndroidReleases,
  resolveAndroidUpdaterUrl,
} from "../AndroidDownloadButton";

const mountedContainers: HTMLDivElement[] = [];

function renderInteractiveButton() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountedContainers.push(container);
  act(() => {
    ReactDOM.render(React.createElement(AndroidDownloadButton), container);
  });
  return container;
}

describe("AndroidDownloadButton", () => {
  beforeEach(() => {
    i18n.setLocale("zh-CN", { persist: false });
    vi.restoreAllMocks();
    apiFetchJsonMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    mountedContainers.splice(0).forEach((container) => {
      act(() => {
        ReactDOM.unmountComponentAtNode(container);
      });
      container.remove();
    });
    vi.useRealTimers();
  });

  it("uses the official GitHub Releases URL as the secondary destination", () => {
    expect(ANDROID_RELEASES_URL).toBe(
      "https://github.com/Mininglamp-OSS/octo-android/releases/latest"
    );
  });

  it("resolves the Android updater endpoint against the configured API URL", () => {
    expect(ANDROID_UPDATER_PATH).toBe("common/updater/android/1.0");
    expect(resolveAndroidUpdaterUrl("/api/v1/")).toBe(
      "/api/v1/common/updater/android/1.0"
    );
    expect(resolveAndroidUpdaterUrl("https://api.example.com/v1")).toBe(
      "https://api.example.com/v1/common/updater/android/1.0"
    );
  });

  it("renders a button trigger instead of a direct APK download link", () => {
    const html = renderToStaticMarkup(
      React.createElement(AndroidDownloadButton)
    );

    expect(html).toContain("<button");
    expect(html).toContain('data-position="bottom"');
    expect(html).toContain('data-trigger="custom"');
    expect(html).toContain(
      'data-content-class="wk-login-mobile-download-popover-shell"'
    );
    expect(html).toContain('data-arrow-background="var(--wk-bg-surface)"');
    expect(html).toContain('data-arrow-border="var(--wk-border-default)"');
    expect(html).toContain('data-wrapper-background="transparent"');
    expect(html).toContain('data-wrapper-shadow="none"');
    expect(html).toContain('data-wrapper-padding="0"');
    expect(html).toContain(">Android</span>");
    expect(html).toContain('width="20"');
    expect(html).toContain('height="20"');
    expect(html).not.toContain("下载 Android 客户端");
    expect(html).not.toContain(" download");
    expect(html).not.toContain("/download/dmwork.apk");
  });

  it("click toggles the popover for touch and keyboard users", () => {
    const container = renderInteractiveButton();
    const popover = container.querySelector('[data-position="bottom"]');
    const trigger = container.querySelector(".wk-login-download-btn");

    expect(popover?.getAttribute("data-visible")).toBe("false");
    act(() => {
      Simulate.click(trigger as Element);
    });
    expect(popover?.getAttribute("data-visible")).toBe("true");
    act(() => {
      Simulate.click(trigger as Element);
    });
    expect(popover?.getAttribute("data-visible")).toBe("false");
  });

  it("opens on hover without pinning the popover", () => {
    const container = renderInteractiveButton();
    const popover = container.querySelector('[data-position="bottom"]');
    const trigger = container.querySelector(".wk-login-download-btn");

    expect(popover?.getAttribute("data-visible")).toBe("false");
    act(() => {
      Simulate.mouseEnter(trigger as Element);
    });
    expect(popover?.getAttribute("data-visible")).toBe("true");
    act(() => {
      Simulate.mouseLeave(trigger as Element);
      vi.runAllTimers();
    });
    expect(popover?.getAttribute("data-visible")).toBe("false");
  });

  it("closes a pinned popover with Escape", () => {
    const container = renderInteractiveButton();
    const popover = container.querySelector('[data-position="bottom"]');
    const trigger = container.querySelector(".wk-login-download-btn");

    act(() => {
      Simulate.click(trigger as Element);
    });
    expect(popover?.getAttribute("data-visible")).toBe("true");
    act(() => {
      Simulate.keyDown(trigger as Element, { key: "Escape" });
    });
    expect(popover?.getAttribute("data-visible")).toBe("false");
  });

  it("renders a fixed-size loading state without an old QR code or link", () => {
    const html = renderToStaticMarkup(
      React.createElement(AndroidDownloadPopoverContent)
    );

    expect(html).toContain("wk-login-mobile-popover-qr");
    expect(html).not.toContain('role="img"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('data-spin="true"');
    expect(html).toContain('aria-label="正在获取下载地址"');
    expect(html).not.toContain("data-qr-value");
    expect(html).toContain(">扫码下载</strong>");
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain("/download/dmwork.apk");
    expect(html).not.toContain(" download");
    expect(html).toContain("或前往 GitHub 手动下载");
    expect(html).toContain('data-icon="github"');
    expect(html).toContain("wk-btn");
    expect(html).toMatch(
      /<button[^>]*>.*data-icon="github".*或前往 GitHub 手动下载.*<\/button>/
    );
    expect(html).not.toContain('data-icon-only="true"');
    expect(html).toContain('aria-label="打开 GitHub Releases"');
  });

  it("uses one updater-provided APK URL for the QR code and direct action", async () => {
    const updaterUrl = "https://cdn.example.com/releases/octo-latest.apk";
    apiFetchJsonMock.mockResolvedValue({ url: updaterUrl });
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountedContainers.push(container);
    act(() => {
      ReactDOM.render(
        React.createElement(AndroidDownloadPopoverContent),
        container
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(apiFetchJsonMock).toHaveBeenCalledWith(
      "/api/v1/common/updater/android/1.0"
    );
    expect(
      container.querySelector("[data-qr-value]")?.getAttribute("data-qr-value")
    ).toBe(updaterUrl);
    expect(
      container
        .querySelector(".wk-login-mobile-popover-qr")
        ?.getAttribute("role")
    ).toBe("img");
    expect(
      container.querySelector<HTMLAnchorElement>(
        ".wk-login-mobile-download-direct-link"
      )?.href
    ).toBe(updaterUrl);
    expect(
      container
        .querySelector<HTMLAnchorElement>(
          ".wk-login-mobile-download-direct-link"
        )
        ?.hasAttribute("download")
    ).toBe(true);
    expect(apiFetchJsonMock).toHaveBeenCalledTimes(1);
  });

  it("shows an error without a stale QR code and retries the updater", async () => {
    const updaterUrl = "https://cdn.example.com/releases/octo-latest.apk";
    apiFetchJsonMock
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ url: updaterUrl });
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountedContainers.push(container);
    act(() => {
      ReactDOM.render(
        React.createElement(AndroidDownloadPopoverContent),
        container
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector("[data-qr-value]")).toBeNull();
    expect(container.textContent).toContain("下载地址获取失败");
    expect(
      container
        .querySelector(".wk-login-mobile-download-direct-link")
        ?.getAttribute("aria-disabled")
    ).toBe("true");

    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "重试"
    );
    expect(retryButton?.tagName).toBe("BUTTON");
    expect(retryButton?.closest('[role="img"]')).toBeNull();

    act(() => {
      Simulate.click(retryButton as Element);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector("[data-qr-value]")?.getAttribute("data-qr-value")
    ).toBe(updaterUrl);
    expect(apiFetchJsonMock).toHaveBeenCalledTimes(2);
  });

  it("opens GitHub Releases safely in a new tab", () => {
    const openedWindow = { opener: {} };
    const openSpy = vi
      .spyOn(window, "open")
      .mockReturnValue(openedWindow as unknown as Window);

    openAndroidReleases();

    expect(openSpy).toHaveBeenCalledWith(
      ANDROID_RELEASES_URL,
      "_blank",
      "noopener,noreferrer"
    );
    expect(openedWindow.opener).toBeNull();
  });
});
