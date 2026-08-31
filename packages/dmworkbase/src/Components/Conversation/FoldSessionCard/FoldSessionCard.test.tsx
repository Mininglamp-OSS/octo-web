// @vitest-environment jsdom

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FoldSessionCard from "./index";

vi.mock("../../../i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => ReactDOM.unmountComponentAtNode(container));
  container.remove();
});

function renderCard(props: Record<string, unknown> = {}) {
  const onSummaryContextMenu = vi.fn();
  act(() => {
    ReactDOM.render(
      <FoldSessionCard
        participants={[]}
        count={1}
        showSummary
        summaryContent="summary"
        onSummaryContextMenu={onSummaryContextMenu}
        {...props}
      />,
      container,
    );
  });
  return { onSummaryContextMenu };
}

describe("FoldSessionCard summary keyboard context menu", () => {
  it.each([
    { key: "F10", shiftKey: true },
    { key: "ContextMenu", shiftKey: false },
  ])("opens from $key", ({ key, shiftKey }) => {
    const { onSummaryContextMenu } = renderCard();
    const summary = container.querySelector<HTMLElement>(".wk-fold-session-card-summary")!;
    vi.spyOn(summary, "getBoundingClientRect").mockReturnValue({
      left: 20,
      top: 30,
      width: 100,
      height: 40,
      right: 120,
      bottom: 70,
      x: 20,
      y: 30,
      toJSON: () => ({}),
    });

    act(() => summary.dispatchEvent(new KeyboardEvent("keydown", {
      key,
      shiftKey,
      bubbles: true,
      cancelable: true,
    })));

    expect(onSummaryContextMenu).toHaveBeenCalledTimes(1);
    expect(summary.tabIndex).toBe(0);
  });

  it("does not expose or trigger the shortcut in selection mode", () => {
    const { onSummaryContextMenu } = renderCard({ selectionMode: true });
    const summary = container.querySelector<HTMLElement>(".wk-fold-session-card-summary")!;

    act(() => summary.dispatchEvent(new KeyboardEvent("keydown", {
      key: "F10",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })));

    expect(onSummaryContextMenu).not.toHaveBeenCalled();
    expect(summary.getAttribute("tabindex")).toBeNull();
  });
});
