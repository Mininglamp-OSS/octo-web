// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import SettingsStatusTag from "../SettingsStatusTag";

describe("SettingsStatusTag", () => {
  it.each(["success", "attention", "danger", "neutral"] as const)("renders %s as a read-only status", (tone) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      ReactDOM.render(<SettingsStatusTag tone={tone} label={`${tone} state`} />, container);
    });
    const tag = container.querySelector('[role="status"]');
    expect(tag).toHaveTextContent(`${tone} state`);
    expect(tag).toHaveClass(`wk-settings-status-tag--${tone}`);
    expect(tag?.querySelector("button")).toBeNull();
    expect(tag?.querySelector(".wk-settings-status-tag__dot")).toBeNull();
    act(() => ReactDOM.unmountComponentAtNode(container));
    container.remove();
  });
});
