import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOM from "react-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { act, Simulate } from "react-dom/test-utils";
import { i18n } from "@octo/base/src/i18n/instance";

vi.mock("@douyinfe/semi-ui", () => ({
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
  IOS_DOWNLOAD_URL,
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

  it("points at the public TestFlight URL", () => {
    expect(IOS_DOWNLOAD_URL).toBe("https://testflight.apple.com/join/uPrdCcy3");
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

  it("renders the TestFlight URL as a scannable QR code", () => {
    const html = renderToStaticMarkup(
      React.createElement(IOSDownloadPopoverContent)
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain(`data-qr-value="${IOS_DOWNLOAD_URL}"`);
    expect(html).toContain("wk-login-mobile-popover-qr");
    expect(html).not.toContain("wk-login-ios-popover-qr");
    expect(html).toContain("TestFlight 安装二维码");
    expect(html).toContain(">扫码下载</strong>");
    expect(html).not.toContain("手机扫码安装");
  });

  it("provides a direct TestFlight action for same-device mobile users", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      React.createElement(IOSDownloadPopoverContent)
    );

    const directDownload = container.querySelector<HTMLAnchorElement>(
      ".wk-login-mobile-download-direct-link"
    );
    expect(directDownload?.href).toBe(IOS_DOWNLOAD_URL);
    expect(directDownload?.target).toBe("_blank");
    expect(directDownload?.rel).toBe("noopener noreferrer");
    expect(directDownload?.textContent).toBe("打开 TestFlight");
  });
});
