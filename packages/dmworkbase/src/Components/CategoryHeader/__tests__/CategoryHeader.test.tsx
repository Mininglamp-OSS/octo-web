/**
 * @vitest-environment jsdom
 */

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CategoryHeader from "../index";

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
