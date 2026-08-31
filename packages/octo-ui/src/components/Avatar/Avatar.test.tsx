// @vitest-environment jsdom

import { fireEvent } from "@testing-library/dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Avatar, { getAvatarFallback } from "./index";

describe("Avatar", () => {
  it("renders the accepted default person appearance", () => {
    const html = renderToStaticMarkup(
      <Avatar alt="刘一" fallbackText="刘一鸣" />
    );

    expect(html).toContain("octo-ui-avatar--person");
    expect(html).toContain("octo-ui-avatar--size-32");
    expect(html).toContain("octo-ui-avatar--tone-0");
    expect(html).toContain('aria-label="刘一"');
    expect(html).toContain(">刘一<");
  });

  it("renders an image with the requested loading policy", () => {
    const html = renderToStaticMarkup(
      <Avatar src="/avatar.png" alt="Candice" size={20} imageLoading="eager" />
    );

    expect(html).toContain("octo-ui-avatar--size-20");
    expect(html).toContain("octo-ui-avatar--has-image");
    expect(html).toContain('src="/avatar.png"');
    expect(html).toContain('alt="Candice"');
    expect(html).toContain('loading="eager"');
    expect(html).toContain('decoding="async"');
  });

  it("does not mark text fallback avatars as image avatars", () => {
    const html = renderToStaticMarkup(
      <Avatar alt="Candice" fallbackText="CA" tone={8} />
    );

    expect(html).not.toContain("octo-ui-avatar--has-image");
  });

  it("retries a previously failed source after the source changes", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<Avatar src="/broken.png" alt="Candice" fallbackText="CA" />);
    });

    act(() => {
      fireEvent.error(container.querySelector("img") as HTMLImageElement);
    });
    expect(container.querySelector("img")).toBeNull();

    act(() => {
      root.render(
        <Avatar src="/placeholder.svg" alt="Candice" fallbackText="CA" />
      );
    });
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/placeholder.svg"
    );

    act(() => {
      root.render(<Avatar src="/broken.png" alt="Candice" fallbackText="CA" />);
    });
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/broken.png"
    );

    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("uses the built-in group icon when group text is absent", () => {
    const html = renderToStaticMarkup(
      <Avatar alt="Unnamed group" kind="group" tone={9} />
    );

    expect(html).toContain("octo-ui-avatar--group");
    expect(html).toContain("octo-ui-avatar--tone-9");
    expect(html).toContain("octo-ui-avatar__group-icon");
  });

  it("lays out three and four CJK characters on two lines", () => {
    expect(
      renderToStaticMarkup(<>{getAvatarFallback("三个字", "group")}</>)
    ).toBe(
      '<span class="octo-ui-avatar__lines"><span>三</span><span>个字</span></span>'
    );
    expect(
      renderToStaticMarkup(<>{getAvatarFallback("架构讨论额外", "group")}</>)
    ).toBe(
      '<span class="octo-ui-avatar__lines"><span>架构</span><span>讨论</span></span>'
    );
  });

  it("keeps non-CJK group text on one line and truncates it", () => {
    expect(getAvatarFallback("abcdef", "group")).toBe("abcd");
  });
});
