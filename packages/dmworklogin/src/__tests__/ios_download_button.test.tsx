import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOM from "react-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { act, Simulate } from "react-dom/test-utils";
import { i18n } from "@octo/base/src/i18n/instance";

const { apiFetchJsonMock } = vi.hoisted(() => ({
  apiFetchJsonMock: vi.fn(),
}));

type MockWKButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
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
  WKButton: ({ children, ...props }: MockWKButtonProps) =>
    React.createElement("button", props, children),
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

vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value }: { value: string }) =>
    React.createElement("svg", { "data-qr-value": value }),
}));

import {
  IOSDownloadButton,
  IOSDownloadPopoverContent,
  IOS_UPDATER_PATH,
} from "../IOSDownloadButton";

const mountedContainers: HTMLDivElement[] = [];

function renderInteractiveButton() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountedContainers.push(container);
  act(() => {
    ReactDOM.render(React.createElement(IOSDownloadButton), container);
  });
  return container;
}

describe("IOSDownloadButton", () => {
  beforeEach(() => {
    i18n.setLocale("zh-CN", { persist: false });
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

  it("uses the iOS updater endpoint", () => {
    expect(IOS_UPDATER_PATH).toBe("common/updater/ios/1.0.0");
  });

  it("renders a non-navigation button trigger", () => {
    const html = renderToStaticMarkup(React.createElement(IOSDownloadButton));
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
    expect(html).toContain("<button");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("target=");
    expect(html).not.toContain("rel=");
    expect(html).toContain('aria-label="悬停或点击查看 iOS 安装二维码"');
    expect(html).toContain(">iOS</span>");
    expect(html).toContain('width="20"');
    expect(html).toContain('height="20"');
    expect(html).not.toContain("下载 iOS 客户端");
    expect(html).toContain("wk-login-download-btn");
  });

  it("opens on hover without navigating", () => {
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

  it("click only toggles the popover pinned state", () => {
    const container = renderInteractiveButton();
    const popover = container.querySelector('[data-position="bottom"]');
    const trigger = container.querySelector(".wk-login-download-btn");

    expect(trigger?.tagName).toBe("BUTTON");
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

  it("renders a loading state without a stale TestFlight QR code", () => {
    const html = renderToStaticMarkup(
      React.createElement(IOSDownloadPopoverContent)
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('data-spin="true"');
    expect(html).toContain('aria-label="正在获取下载地址"');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain("data-qr-value");
    expect(html).not.toContain("testflight.apple.com");
    expect(html).toContain("wk-login-mobile-popover-qr");
    expect(html).not.toContain("wk-login-ios-popover-qr");
    expect(html).toContain(">扫码下载</strong>");
    expect(html).not.toContain("手机扫码安装");
  });

  it("renders the updater-provided iOS URL as a scannable QR code", async () => {
    const updaterUrl = "https://testflight.apple.com/join/backendCode";
    apiFetchJsonMock.mockResolvedValue({ url: updaterUrl });
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountedContainers.push(container);
    act(() => {
      ReactDOM.render(
        React.createElement(IOSDownloadPopoverContent),
        container
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(apiFetchJsonMock).toHaveBeenCalledWith(
      "/api/v1/common/updater/ios/1.0.0"
    );
    expect(
      container.querySelector("[data-qr-value]")?.getAttribute("data-qr-value")
    ).toBe(updaterUrl);
    expect(
      container
        .querySelector(".wk-login-mobile-popover-qr")
        ?.getAttribute("role")
    ).toBe("img");
  });

  it("shows an error without a stale QR code when the updater fails", async () => {
    apiFetchJsonMock.mockRejectedValue(new Error("network error"));
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountedContainers.push(container);
    act(() => {
      ReactDOM.render(
        React.createElement(IOSDownloadPopoverContent),
        container
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector("[data-qr-value]")).toBeNull();
    expect(container.textContent).toContain("下载地址获取失败");
    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "重试"
    );
    expect(retryButton?.tagName).toBe("BUTTON");
    expect(retryButton?.closest('[role="img"]')).toBeNull();
  });

  it("does not render the removed direct TestFlight action", () => {
    const html = renderToStaticMarkup(
      React.createElement(IOSDownloadPopoverContent)
    );

    expect(html).not.toContain("wk-login-mobile-download-direct-link");
    expect(html).not.toContain("打开 TestFlight");
  });
});
