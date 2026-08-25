// @vitest-environment jsdom

import React from "react";
import {
  fireEvent,
  getAllByRole,
  getByRole,
  queryByRole,
} from "@testing-library/dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tabs } from "./index";
import type { TabItem } from "./types";

const items: TabItem[] = [
  { key: "first", label: "First", children: <div>First panel</div> },
  { key: "disabled", label: "Disabled", isDisabled: true },
  { key: "third", label: "Third", children: <div>Third panel</div> },
];

let container: HTMLDivElement;
let root: Root;

const render = (ui: React.ReactNode) => {
  act(() => root.render(ui));
};

const click = (element: Element) => {
  act(() => fireEvent.click(element));
};

const keyDown = (element: Element, key: string) => {
  act(() => fireEvent.keyDown(element, { key }));
};

describe("Tabs", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Element.prototype.scrollIntoView = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the design defaults and linked tab panel", () => {
    render(<Tabs id="example" aria-label="Example tabs" items={items} />);

    const tablist = getByRole(container, "tablist", { name: "Example tabs" });
    const first = getByRole(container, "tab", { name: "First" });
    const third = getByRole(container, "tab", { name: "Third" });
    const panel = getByRole(container, "tabpanel");

    expect(tablist.parentElement?.className).toContain("octo-ui-tabs--line");
    expect(tablist.parentElement?.className).toContain("octo-ui-tabs--md");
    expect(first.getAttribute("aria-selected")).toBe("true");
    expect(first.getAttribute("aria-controls")).toBe("example-panel-0");
    expect(third.hasAttribute("aria-controls")).toBe(false);
    expect(panel.getAttribute("aria-labelledby")).toBe("example-tab-0");
    expect(panel.textContent).toBe("First panel");
  });

  it.each(["segmented", "segmented-plain"] as const)(
    "renders the %s design variant",
    (variant) => {
      render(
        <Tabs aria-label={`${variant} tabs`} items={items} variant={variant} />
      );

      expect(
        getByRole(container, "tablist").parentElement?.className
      ).toContain(`octo-ui-tabs--${variant}`);
    }
  );

  it("updates itself in uncontrolled mode", () => {
    const onChange = vi.fn();
    render(
      <Tabs
        aria-label="Uncontrolled tabs"
        items={items}
        defaultActiveKey="third"
        onChange={onChange}
      />
    );

    click(getByRole(container, "tab", { name: "First" }));

    expect(onChange).toHaveBeenCalledWith("first");
    expect(
      getByRole(container, "tab", { name: "First" }).getAttribute(
        "aria-selected"
      )
    ).toBe("true");
    expect(getByRole(container, "tabpanel").textContent).toBe("First panel");
  });

  it("reports a controlled change without changing the active tab itself", () => {
    const onChange = vi.fn();
    render(
      <Tabs
        aria-label="Controlled tabs"
        items={items}
        activeKey="first"
        onChange={onChange}
      />
    );

    click(getByRole(container, "tab", { name: "Third" }));

    expect(onChange).toHaveBeenCalledWith("third");
    expect(
      getByRole(container, "tab", { name: "First" }).getAttribute(
        "aria-selected"
      )
    ).toBe("true");
    expect(
      getByRole(container, "tab", { name: "Third" }).getAttribute(
        "aria-selected"
      )
    ).toBe("false");
  });

  it("does not activate or report disabled items", () => {
    const onChange = vi.fn();
    render(
      <Tabs aria-label="Disabled tabs" items={items} onChange={onChange} />
    );

    const disabled = getByRole(container, "tab", { name: "Disabled" });
    click(disabled);

    expect(disabled.hasAttribute("disabled")).toBe(true);
    expect(disabled.getAttribute("aria-disabled")).toBe("true");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("uses automatic keyboard activation and skips disabled items", () => {
    const onChange = vi.fn();
    render(
      <Tabs aria-label="Keyboard tabs" items={items} onChange={onChange} />
    );

    const first = getByRole(container, "tab", { name: "First" });
    const third = getByRole(container, "tab", { name: "Third" });
    first.focus();
    keyDown(first, "ArrowRight");

    expect(document.activeElement).toBe(third);
    expect(third.getAttribute("aria-selected")).toBe("true");
    expect(onChange).toHaveBeenCalledWith("third");

    keyDown(third, "Home");
    expect(document.activeElement).toBe(first);
    keyDown(first, "End");
    expect(document.activeElement).toBe(third);
  });

  it("keeps one enabled tab in the tab order when a controlled key is unknown", () => {
    render(
      <Tabs
        aria-label="Unknown controlled key"
        items={items}
        activeKey="missing"
      />
    );

    expect(
      getByRole(container, "tab", { name: "First" }).getAttribute("tabindex")
    ).toBe("0");
    expect(queryByRole(container, "tabpanel")).toBeNull();
  });

  it("keeps an enabled tab focusable when the controlled active item is disabled", () => {
    render(
      <Tabs
        aria-label="Disabled active key"
        items={items}
        activeKey="disabled"
      />
    );

    expect(
      getByRole(container, "tab", { name: "Disabled" }).getAttribute(
        "aria-selected"
      )
    ).toBe("true");
    expect(
      getByRole(container, "tab", { name: "First" }).getAttribute("tabindex")
    ).toBe("0");
  });

  it("normalizes uncontrolled state when the active item is removed", () => {
    render(<Tabs aria-label="Dynamic items" items={items} />);
    render(<Tabs aria-label="Dynamic items" items={items.slice(1)} />);
    render(<Tabs aria-label="Dynamic items" items={items} />);

    expect(
      getByRole(container, "tab", { name: "Third" }).getAttribute(
        "aria-selected"
      )
    ).toBe("true");
  });

  it("renders no active tab when every item is disabled", () => {
    render(
      <Tabs
        aria-label="All disabled"
        items={items.map((item) => ({ ...item, isDisabled: true }))}
      />
    );

    expect(
      getAllByRole(container, "tab").every(
        (tab) => tab.getAttribute("aria-selected") === "false"
      )
    ).toBe(true);
    expect(queryByRole(container, "tabpanel")).toBeNull();
  });
});
