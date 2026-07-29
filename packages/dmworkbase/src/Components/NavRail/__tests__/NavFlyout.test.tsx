import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import NavFlyout, { NavFlyoutMenuItem } from "../NavFlyout";

let container: HTMLDivElement;
let trigger: HTMLButtonElement;

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    trigger = document.createElement("button");
    trigger.textContent = "trigger";
    document.body.appendChild(trigger);
});

afterEach(() => {
    act(() => {
        ReactDOM.unmountComponentAtNode(container);
    });
    trigger.remove();
    container.remove();
    document.querySelectorAll(".wk-navrail__flyout, .wk-navrail__flyout-mask").forEach((node) => node.remove());
});

function renderFlyout(open: boolean, onOpenChange: (open: boolean) => void) {
    act(() => {
        ReactDOM.render(
            <NavFlyout
                open={open}
                triggerRef={{ current: trigger }}
                onOpenChange={onOpenChange}
                role="menu"
                ariaLabel="Demo menu"
            >
                <NavFlyoutMenuItem>Action</NavFlyoutMenuItem>
            </NavFlyout>,
            container,
        );
    });
}

describe("NavFlyout", () => {
    it("renders through a portal with shared menu semantics", () => {
        renderFlyout(true, () => {});

        const flyout = document.body.querySelector(".wk-navrail__flyout") as HTMLElement | null;
        expect(flyout).toBeTruthy();
        expect(flyout?.getAttribute("role")).toBe("menu");
        expect(flyout?.getAttribute("aria-label")).toBe("Demo menu");
        expect(flyout?.querySelector("button")?.getAttribute("role")).toBe("menuitem");
    });

    it("closes on outside click", () => {
        const calls: boolean[] = [];
        renderFlyout(true, (next) => calls.push(next));

        act(() => {
            (document.body.querySelector(".wk-navrail__flyout-mask") as HTMLDivElement).click();
        });

        expect(calls).toEqual([false]);
    });

    it("closes on Escape", () => {
        const calls: boolean[] = [];
        renderFlyout(true, (next) => calls.push(next));

        act(() => {
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        });

        expect(calls).toEqual([false]);
    });

    it("restores focus to the trigger after closing", () => {
        renderFlyout(true, () => {});
        renderFlyout(false, () => {});

        expect(document.activeElement).toBe(trigger);
    });
});
