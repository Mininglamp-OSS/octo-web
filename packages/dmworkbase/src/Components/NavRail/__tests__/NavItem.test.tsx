/**
 * @vitest-environment jsdom
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
    it("renders shortLabel in the visible label span but keeps the full label on aria-label and title", () => {
        act(() => {
            ReactDOM.render(
                <NavItem icon={<span />} label="AI Summary" shortLabel="Summary" />,
                container,
            );
        });

        const button = container.querySelector("button.wk-navrail__item")!;
        expect(button.getAttribute("aria-label")).toBe("AI Summary");
        expect(button.getAttribute("title")).toBe("AI Summary");

        const labelSpan = container.querySelector(".wk-navrail__item-label")!;
        expect(labelSpan.textContent).toBe("Summary");
    });

    it("falls back to the full label when shortLabel is not provided", () => {
        act(() => {
            ReactDOM.render(
                <NavItem icon={<span />} label="Chats" />,
                container,
            );
        });

        const labelSpan = container.querySelector(".wk-navrail__item-label")!;
        expect(labelSpan.textContent).toBe("Chats");
        expect(
            container.querySelector("button.wk-navrail__item")!.getAttribute("title"),
        ).toBe("Chats");
    });

    it("treats an empty shortLabel as absent and falls back to the full label", () => {
        act(() => {
            ReactDOM.render(
                <NavItem icon={<span />} label="Contacts" shortLabel="" />,
                container,
            );
        });

        const labelSpan = container.querySelector(".wk-navrail__item-label")!;
        expect(labelSpan.textContent).toBe("Contacts");
    });
});
