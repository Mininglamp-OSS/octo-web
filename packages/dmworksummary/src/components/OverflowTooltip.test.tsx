import React from "react";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import OverflowTooltip from "./OverflowTooltip";

// Mock semi Tooltip: render content only when `visible` is true. The real
// component drives visibility via its own onMouseEnter/onMouseLeave on the
// wrapped child (trigger="custom") and supplies a stable `content` from the
// `title` prop, so the mock renders `children` as-is and lets those handlers
// flow through.
vi.mock("@douyinfe/semi-ui", () => ({
    Tooltip: ({ children, content, visible, trigger }: any) => (
        <div data-testid="tooltip-wrapper" data-visible={visible} data-trigger={trigger}>
            {visible && <div data-testid="tooltip-content">{content}</div>}
            {children}
        </div>
    ),
}));

function render(ui: React.ReactElement, options?: any) {
    return rtlRender(ui, { legacyRoot: true, ...options });
}

function mockOverflow(el: HTMLElement, overflowing: boolean) {
    Object.defineProperty(el, "scrollWidth", { value: overflowing ? 200 : 100, configurable: true });
    Object.defineProperty(el, "clientWidth", { value: 100, configurable: true });
}

describe("OverflowTooltip", () => {
    it("does not show tooltip when text is not overflowing", () => {
        render(<OverflowTooltip title="Short text">Short text</OverflowTooltip>);

        const container = screen.getByText("Short text");
        mockOverflow(container, false);

        fireEvent.mouseEnter(container);

        expect(screen.queryByTestId("tooltip-content")).not.toBeInTheDocument();
    });

    it("shows tooltip when text is overflowing", () => {
        const text = "This is a very long text that overflows";
        render(<OverflowTooltip title={text}>{text}</OverflowTooltip>);

        const container = screen.getByText(text);
        mockOverflow(container, true);

        fireEvent.mouseEnter(container);

        expect(screen.getByTestId("tooltip-content")).toBeInTheDocument();
    });

    it("uses the title prop as the tooltip content", () => {
        render(<OverflowTooltip title="Full title text">Truncated…</OverflowTooltip>);

        const container = screen.getByText("Truncated…");
        mockOverflow(container, true);

        fireEvent.mouseEnter(container);

        expect(screen.getByTestId("tooltip-content")).toHaveTextContent("Full title text");
    });

    it("hides tooltip on mouse leave", () => {
        render(<OverflowTooltip title="Overflowing text">Overflowing text</OverflowTooltip>);

        const container = screen.getByText("Overflowing text");
        mockOverflow(container, true);

        fireEvent.mouseEnter(container);
        expect(screen.getByTestId("tooltip-content")).toBeInTheDocument();

        fireEvent.mouseLeave(container);
        expect(screen.queryByTestId("tooltip-content")).not.toBeInTheDocument();
    });

    it("renders correct element type when as prop is provided", () => {
        render(<OverflowTooltip as="span" title="Content">Content</OverflowTooltip>);

        const el = screen.getByText("Content");
        expect(el.tagName).toBe("SPAN");
    });

    it("passes className and style correctly", () => {
        render(
            <OverflowTooltip className="custom-class" style={{ color: "red" }} title="Styled content">
                Styled content
            </OverflowTooltip>
        );

        const el = screen.getByText("Styled content");
        expect(el).toHaveClass("custom-class");
        expect(el).toHaveStyle("color: rgb(255, 0, 0); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;");
    });

    it("uses a fully controlled (custom) trigger so semi never self-mounts an overlay", () => {
        render(<OverflowTooltip title="Text">Text</OverflowTooltip>);

        const wrapper = screen.getByTestId("tooltip-wrapper");
        expect(wrapper).toHaveAttribute("data-trigger", "custom");
    });

    it("keeps the overlay closed until the title actually overflows", () => {
        render(<OverflowTooltip title="Some title">Some title</OverflowTooltip>);

        const wrapper = screen.getByTestId("tooltip-wrapper");
        // Before any hover, visibility is driven solely by `visible` (false).
        expect(wrapper).toHaveAttribute("data-visible", "false");
        expect(screen.queryByTestId("tooltip-content")).not.toBeInTheDocument();
    });
});
