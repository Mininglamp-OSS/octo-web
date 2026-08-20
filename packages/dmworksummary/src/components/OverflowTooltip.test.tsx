import React, { act } from "react";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import OverflowTooltip from "./OverflowTooltip";

vi.mock("@octo/ui", () => ({
    Tooltip: ({ children, content, isDisabled }: { children: React.ReactNode; content: React.ReactNode; isDisabled?: boolean }) => (
        <div data-testid={isDisabled ? "tooltip-trigger" : "tooltip-wrapper"}>
            {children}
            {!isDisabled && <div data-testid="tooltip-content">{content}</div>}
        </div>
    ),
}));

type ResizeCallback = ResizeObserverCallback;
const resizeObservers: MockResizeObserver[] = [];

class MockResizeObserver {
    private readonly callback: ResizeCallback;
    private readonly elements = new Set<Element>();

    constructor(callback: ResizeCallback) {
        this.callback = callback;
        resizeObservers.push(this);
    }

    observe(element: Element) {
        this.elements.add(element);
    }

    disconnect() {
        this.elements.clear();
    }

    trigger(element: Element) {
        if (this.elements.has(element)) this.callback([], this as unknown as ResizeObserver);
    }
}

beforeEach(() => {
    resizeObservers.length = 0;
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function render(ui: React.ReactElement, options?: any) {
    return rtlRender(ui, { legacyRoot: true, ...options });
}

function mockOverflow(el: HTMLElement, overflowing: boolean) {
    Object.defineProperty(el, "scrollWidth", { value: overflowing ? 200 : 100, configurable: true });
    Object.defineProperty(el, "clientWidth", { value: 100, configurable: true });
    fireEvent(window, new Event("resize"));
}

function triggerResize(el: HTMLElement) {
    act(() => {
        resizeObservers.forEach((observer) => observer.trigger(el));
    });
}

describe("OverflowTooltip", () => {
    it("does not show tooltip when text is not overflowing", () => {
        render(<OverflowTooltip title="Short text">Short text</OverflowTooltip>);

        const container = screen.getByText("Short text");
        mockOverflow(container, false);

        expect(screen.queryByTestId("tooltip-wrapper")).not.toBeInTheDocument();
        expect(screen.queryByTestId("tooltip-content")).not.toBeInTheDocument();
    });

    it("shows tooltip when text is overflowing", () => {
        const text = "This is a very long text that overflows";
        render(<OverflowTooltip title={text}>{text}</OverflowTooltip>);

        const container = screen.getByText(text);
        mockOverflow(container, true);

        expect(screen.getByTestId("tooltip-wrapper")).toBeInTheDocument();
        expect(screen.getByTestId("tooltip-content")).toBeInTheDocument();
    });

    it("uses the title prop as the tooltip content", () => {
        render(<OverflowTooltip title="Full title text">Truncated…</OverflowTooltip>);

        const container = screen.getByText("Truncated…");
        mockOverflow(container, true);

        expect(screen.getByTestId("tooltip-content")).toHaveTextContent("Full title text");
    });

    it("removes the tooltip wrapper after the content no longer overflows", () => {
        render(<OverflowTooltip title="Overflowing text">Overflowing text</OverflowTooltip>);

        const container = screen.getByText("Overflowing text");
        mockOverflow(container, true);
        expect(screen.getByTestId("tooltip-wrapper")).toBeInTheDocument();

        mockOverflow(container, false);
        expect(screen.queryByTestId("tooltip-wrapper")).not.toBeInTheDocument();
    });

    it("keeps observing the live element after truncation toggles", () => {
        render(<OverflowTooltip title="Resize observed text">Resize observed text</OverflowTooltip>);

        const initialElement = screen.getByText("Resize observed text");
        Object.defineProperty(initialElement, "scrollWidth", { value: 200, configurable: true });
        Object.defineProperty(initialElement, "clientWidth", { value: 100, configurable: true });
        triggerResize(initialElement);
        expect(screen.getByTestId("tooltip-wrapper")).toBeInTheDocument();

        const liveElement = screen.getByTestId("tooltip-wrapper").firstElementChild as HTMLElement;
        Object.defineProperty(liveElement, "scrollWidth", { value: 100, configurable: true });
        triggerResize(liveElement);

        expect(screen.queryByTestId("tooltip-wrapper")).not.toBeInTheDocument();
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

    it("does not mount the shared tooltip until the title actually overflows", () => {
        render(<OverflowTooltip title="Some title">Some title</OverflowTooltip>);

        expect(screen.queryByTestId("tooltip-wrapper")).not.toBeInTheDocument();
        expect(screen.queryByTestId("tooltip-content")).not.toBeInTheDocument();
    });
});
