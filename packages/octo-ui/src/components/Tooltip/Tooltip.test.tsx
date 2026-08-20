import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

interface SemiTooltipMockProps {
  children: ReactNode;
  className?: string;
  content?: ReactNode;
  position?: string;
  mouseEnterDelay?: number;
  mouseLeaveDelay?: number;
  showArrow?: boolean;
  spacing?: number;
  autoAdjustOverflow?: boolean;
}

vi.mock("@douyinfe/semi-ui", () => ({
  Tooltip: ({
    children,
    className,
    content,
    position,
    mouseEnterDelay,
    mouseLeaveDelay,
    showArrow,
    spacing,
    autoAdjustOverflow,
  }: SemiTooltipMockProps) => (
    <span
      className={className}
      data-position={position}
      data-enter-delay={mouseEnterDelay}
      data-leave-delay={mouseLeaveDelay}
      data-show-arrow={String(showArrow)}
      data-spacing={spacing}
      data-auto-adjust={String(autoAdjustOverflow)}
    >
      <span data-testid="tooltip-content">{content}</span>
      {children}
    </span>
  ),
}));

import { Tooltip } from "./index";

describe("Tooltip", () => {
  it("uses the design defaults", () => {
    const html = renderToStaticMarkup(
      <Tooltip content="Full name">
        <button type="button">Name</button>
      </Tooltip>
    );

    expect(html).toContain('class="octo-ui-tooltip"');
    expect(html).toContain('data-position="top"');
    expect(html).toContain('data-enter-delay="0"');
    expect(html).toContain('data-leave-delay="0"');
    expect(html).toContain('data-show-arrow="false"');
    expect(html).toContain('data-spacing="6"');
    expect(html).toContain('data-auto-adjust="true"');
    expect(html).toContain('<button type="button">Name</button>');
  });

  it("maps its own placement API without exposing Semi placement names", () => {
    const html = renderToStaticMarkup(
      <Tooltip content="Details" placement="bottom-start">
        <button type="button">Open</button>
      </Tooltip>
    );

    expect(html).toContain('data-position="bottomLeft"');
  });

  it("renders title, muted body, shortcut, actions, and vertical layout", () => {
    const html = renderToStaticMarkup(
      <Tooltip
        content={{
          title: "Search title",
          body: "Search description",
          shortcut: "⌘F",
          actions: <button type="button">Open</button>,
          layout: "vertical",
        }}
      >
        <span>Target</span>
      </Tooltip>
    );

    expect(html).toContain("octo-ui-tooltip__content--vertical");
    expect(html).toContain("octo-ui-tooltip__content--shortcut");
    expect(html).toContain("octo-ui-tooltip__title");
    expect(html).toContain("octo-ui-tooltip__body--muted");
    expect(html).toContain("octo-ui-tooltip__shortcut");
    expect(html).toContain("octo-ui-tooltip__actions");
  });

  it("maps the design delay special case to 300ms", () => {
    const html = renderToStaticMarkup(
      <Tooltip content="Details" isDelayed className="consumer-tooltip">
        <span>Target</span>
      </Tooltip>
    );

    expect(html).toContain("octo-ui-tooltip consumer-tooltip");
    expect(html).toContain('data-enter-delay="300"');
    expect(html).toContain('data-leave-delay="0"');
  });

  it("does not mount an overlay for disabled or blank content", () => {
    const disabled = renderToStaticMarkup(
      <Tooltip content="Details" isDisabled>
        <span>Disabled</span>
      </Tooltip>
    );
    const blank = renderToStaticMarkup(
      <Tooltip content="   ">
        <span>Blank</span>
      </Tooltip>
    );

    expect(disabled).toBe("<span>Disabled</span>");
    expect(blank).toBe("<span>Blank</span>");
  });

  it("does not render plain objects passed by untyped consumers", () => {
    const invalidContent = {} as unknown as ReactNode;
    const html = renderToStaticMarkup(
      <Tooltip content={invalidContent}>
        <span>Invalid</span>
      </Tooltip>
    );

    expect(html).toBe("<span>Invalid</span>");
  });
});
