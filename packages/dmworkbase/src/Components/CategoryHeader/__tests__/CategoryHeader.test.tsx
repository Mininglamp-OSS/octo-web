/**
 * @vitest-environment jsdom
 */

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CategoryHeader from "../index";

vi.mock("@douyinfe/semi-ui", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("../../../i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

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

describe("CategoryHeader drag handle", () => {
  it("uses Lucide GripVertical when the category is sortable", () => {
    act(() => {
      ReactDOM.render(
        <CategoryHeader
          name="研发"
          isCollapsed={false}
          onToggle={vi.fn()}
          dragHandleRef={() => undefined}
        />,
        container
      );
    });

    expect(
      container.querySelector(
        ".wk-category-header__drag-handle .lucide-grip-vertical"
      )
    ).not.toBeNull();
  });

  it("does not add a drag handle to a static category", () => {
    act(() => {
      ReactDOM.render(
        <CategoryHeader
          name="默认分组"
          isCollapsed={false}
          onToggle={vi.fn()}
        />,
        container
      );
    });

    expect(
      container.querySelector(".wk-category-header__drag-handle")
    ).toBeNull();
  });
});

describe("CategoryHeader management menu", () => {
  it("renders an accessible MoreHorizontal button only when an action is available", () => {
    const onToggle = vi.fn();
    const onMoreClick = vi.fn();

    act(() => {
      ReactDOM.render(
        <CategoryHeader
          name="研发"
          isCollapsed={false}
          onToggle={onToggle}
          onMoreClick={onMoreClick}
        />,
        container
      );
    });

    const button = container.querySelector<HTMLButtonElement>(
      ".wk-category-header__more"
    );
    expect(button).not.toBeNull();
    expect(button?.querySelector(".lucide-ellipsis")).not.toBeNull();
    expect(button?.getAttribute("aria-label")).toBe(
      "base.threadPanel.moreActions"
    );

    act(() => button?.click());

    expect(onMoreClick).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("does not render the management button without a menu handler", () => {
    act(() => {
      ReactDOM.render(
        <CategoryHeader
          name="默认分组"
          isCollapsed={false}
          onToggle={vi.fn()}
        />,
        container
      );
    });

    expect(container.querySelector(".wk-category-header__more")).toBeNull();
  });
});
