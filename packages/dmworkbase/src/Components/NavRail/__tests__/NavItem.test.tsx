/**
 * NavItem short/full label + tooltip behaviour (#1635).
 *
 * The visual toggle between short and full label is CSS-driven — this test
 * verifies the DOM contract NavItem is responsible for (both spans present
 * with the right classes), and that `title` and `aria-label` behave as the
 * NavItem docstring promises. The actual `display: none / inline-flex` swap
 * under `.wk-layout-tab-expanded` is enforced by NavRail/index.css and is
 * not exercised by jsdom (which has no layout).
 */

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import NavItem from "../NavItem";

let container: HTMLDivElement;

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
});

afterEach(() => {
    act(() => {
        ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
});

describe("NavItem label + tooltip", () => {
    it("renders BOTH full and short spans when shortLabel differs from label, so CSS can pick", () => {
        act(() => {
            ReactDOM.render(
                <NavItem icon={<span />} label="AI Summary" shortLabel="Summary" />,
                container,
            );
        });

        const full = container.querySelector(".wk-navrail__item-label--full");
        const short = container.querySelector(".wk-navrail__item-label--short");
        expect(full).not.toBeNull();
        expect(short).not.toBeNull();
        expect(full!.textContent).toBe("AI Summary");
        expect(short!.textContent).toBe("Summary");

        const button = container.querySelector("button.wk-navrail__item")!;
        // Full label always used for a11y and the native tooltip that surfaces
        // the truncated text in the collapsed rail.
        expect(button.getAttribute("aria-label")).toBe("AI Summary");
        expect(button.getAttribute("title")).toBe("AI Summary");
    });

    it("renders a single label span and no title when shortLabel is not provided", () => {
        act(() => {
            ReactDOM.render(
                <NavItem icon={<span />} label="Chats" />,
                container,
            );
        });

        const single = container.querySelector(".wk-navrail__item-label");
        expect(single).not.toBeNull();
        expect(single!.textContent).toBe("Chats");
        expect(container.querySelector(".wk-navrail__item-label--full")).toBeNull();
        expect(container.querySelector(".wk-navrail__item-label--short")).toBeNull();

        const button = container.querySelector("button.wk-navrail__item")!;
        expect(button.hasAttribute("title")).toBe(false);
        expect(button.getAttribute("aria-label")).toBe("Chats");
    });

    it("collapses to a single label span when shortLabel equals label (no visual difference)", () => {
        // e.g. zh-CN summary menu might be wired to shortTitle === title as a no-op.
        act(() => {
            ReactDOM.render(
                <NavItem icon={<span />} label="智能总结" shortLabel="智能总结" />,
                container,
            );
        });

        expect(container.querySelector(".wk-navrail__item-label--full")).toBeNull();
        expect(container.querySelector(".wk-navrail__item-label--short")).toBeNull();

        const single = container.querySelector(".wk-navrail__item-label");
        expect(single!.textContent).toBe("智能总结");

        const button = container.querySelector("button.wk-navrail__item")!;
        // No redundant tooltip repeating fully-visible text.
        expect(button.hasAttribute("title")).toBe(false);
    });

    it("treats an empty shortLabel as absent", () => {
        act(() => {
            ReactDOM.render(
                <NavItem icon={<span />} label="Contacts" shortLabel="" />,
                container,
            );
        });

        const single = container.querySelector(".wk-navrail__item-label");
        expect(single!.textContent).toBe("Contacts");
        expect(container.querySelector(".wk-navrail__item-label--full")).toBeNull();
        expect(container.querySelector("button.wk-navrail__item")!.hasAttribute("title")).toBe(false);
    });
});
