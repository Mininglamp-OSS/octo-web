// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Empty from "./index";

describe("Empty", () => {
  it("renders title, description, default illustration, and action slot", () => {
    const html = renderToStaticMarkup(
      <Empty
        title="暂无数据"
        description="当前还没有任何内容"
        action={<button type="button">新建</button>}
      />
    );

    expect(html).toContain("octo-ui-empty");
    expect(html).toContain("octo-ui-empty__illustration");
    expect(html).toContain("octo-ui-empty__illustration--default");
    expect(html).toContain("octo-ui-empty__title");
    expect(html).toContain("暂无数据");
    expect(html).toContain("当前还没有任何内容");
    expect(html).toContain("<button");
  });

  it("does not force the default illustration sizing class onto custom illustrations", () => {
    const html = renderToStaticMarkup(
      <Empty
        illustration={<svg width="28" height="28" aria-hidden="true" />}
        description="没有结果"
      />
    );

    expect(html).toContain("octo-ui-empty__illustration");
    expect(html).not.toContain("octo-ui-empty__illustration--default");
    expect(html).toContain('width="28"');
    expect(html).toContain('height="28"');
  });

  it("keeps a custom svg illustration from receiving the default rendered sizing", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const style = document.createElement("style");
    style.textContent = `
      .octo-ui-empty__illustration svg {
        display: block;
        max-width: 100%;
        max-height: 100%;
      }

      .octo-ui-empty__illustration--default {
        width: 150px;
        height: 150px;
      }

      .octo-ui-empty__illustration--default svg {
        width: 100%;
        height: 100%;
      }
    `;
    document.head.appendChild(style);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <Empty
          illustration={<svg width="28" height="28" aria-hidden="true" />}
          description="没有结果"
        />
      );
    });

    const illustration = container.querySelector(".octo-ui-empty__illustration") as HTMLElement;
    const svg = illustration.querySelector("svg") as SVGSVGElement;

    expect(illustration.classList.contains("octo-ui-empty__illustration--default")).toBe(false);
    expect(window.getComputedStyle(illustration).width).not.toBe("150px");
    expect(window.getComputedStyle(svg).width).not.toBe("100%");
    expect(svg.getAttribute("width")).toBe("28");
    expect(svg.getAttribute("height")).toBe("28");

    act(() => root.unmount());
    style.remove();
    container.remove();
    vi.unstubAllGlobals();
  });

  it("supports text-only inline empty state without illustration", () => {
    const html = renderToStaticMarkup(
      <Empty
        illustration={false}
        title="暂无数据"
        description="当前还没有任何内容"
      />
    );

    expect(html).not.toContain("octo-ui-empty__illustration");
    expect(html).toContain("octo-ui-empty__title");
    expect(html).toContain("octo-ui-empty__description");
  });

  it("forwards html attributes and custom className", () => {
    const html = renderToStaticMarkup(
      <Empty className="custom-empty" data-testid="empty" title="Empty" />
    );

    expect(html).toContain("octo-ui-empty custom-empty");
    expect(html).toContain('data-testid="empty"');
  });

  it("suppresses nullish slots without reserving illustration space", () => {
    const html = renderToStaticMarkup(
      <Empty illustration={null} title={null} description={undefined} />
    );

    expect(html).not.toContain("octo-ui-empty__illustration");
    expect(html).not.toContain("octo-ui-empty__title");
    expect(html).not.toContain("octo-ui-empty__description");
  });

  it("renders numeric zero slot content", () => {
    const html = renderToStaticMarkup(
      <Empty illustration={false} title={0} description={0} action={0} />
    );

    expect(html).toContain("octo-ui-empty__title");
    expect(html).toContain("octo-ui-empty__description");
    expect(html).toContain("octo-ui-empty__action");
    expect(html).toContain(">0<");
  });
});
