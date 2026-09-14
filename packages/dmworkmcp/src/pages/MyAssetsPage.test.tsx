// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

const spaceHandlers = new Set<() => void>();

vi.mock("@octo/base", () => ({
  t: (key: string) => key,
  useI18n: () => undefined,
  WKApp: {
    mittBus: {
      on: (_event: string, handler: () => void) => spaceHandlers.add(handler),
      off: (_event: string, handler: () => void) =>
        spaceHandlers.delete(handler),
    },
  },
}));

vi.mock("@dmwork/skillmarket", () => ({
  SearchBar: () => React.createElement("input", { type: "search" }),
  SkillListPage: () =>
    React.createElement("div", { "data-testid": "skills-page" }),
}));

vi.mock("./AllAssetsList", () => ({
  default: ({
    onRequestAction,
  }: {
    onRequestAction: (request: unknown) => void;
  }) =>
    React.createElement(
      React.Fragment,
      null,
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () =>
            onRequestAction({
              pluginId: "skill-1",
              type: "skill",
              action: "view",
            }),
        },
        "view from all"
      ),
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () =>
            onRequestAction({
              pluginId: "skill-1",
              type: "skill",
              action: "edit",
            }),
        },
        "edit from all"
      ),
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () =>
            onRequestAction({
              pluginId: "skill-1",
              type: "skill",
              action: "upgrade",
            }),
        },
        "upgrade from all"
      )
    ),
}));

vi.mock("../features/mine/MineActionHost", () => ({
  default: ({
    request,
  }: {
    request: { type: string; action: string } | null;
  }) =>
    React.createElement(
      "div",
      { "data-testid": "edit-host" },
      request ? `${request.type}:${request.action}` : "closed"
    ),
}));

vi.mock("./McpMarketListPage", () => ({ default: () => null }));
vi.mock("./ExpertMarketListPage", () => ({ default: () => null }));

import MyAssetsPage from "./MyAssetsPage";

let container: HTMLDivElement;

afterEach(() => {
  ReactDOM.unmountComponentAtNode(container);
  container.remove();
  spaceHandlers.clear();
});

describe("MyAssetsPage all-tab actions", () => {
  it("opens details in place while keeping the all tab selected", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => ReactDOM.render(<MyAssetsPage />, container));

    const allTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "mcp.mine.tabAll"
    ) as HTMLButtonElement;
    const view = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "view from all"
    ) as HTMLButtonElement;
    act(() => view.click());

    expect(allTab.getAttribute("aria-pressed")).toBe("true");
    expect(
      container.querySelector('[data-testid="edit-host"]')?.textContent
    ).toBe("skill:view");
  });

  it("opens edit in place while keeping the all tab selected", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => ReactDOM.render(<MyAssetsPage />, container));

    const allTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "mcp.mine.tabAll"
    ) as HTMLButtonElement;
    const edit = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "edit from all"
    ) as HTMLButtonElement;
    act(() => edit.click());

    expect(allTab.getAttribute("aria-pressed")).toBe("true");
    expect(
      container.querySelector('[data-testid="edit-host"]')?.textContent
    ).toBe("skill:edit");
    expect(container.querySelector('[data-testid="skills-page"]')).toBeNull();
  });

  it("opens upgrade in place while keeping the all tab selected", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => ReactDOM.render(<MyAssetsPage />, container));

    const allTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "mcp.mine.tabAll"
    ) as HTMLButtonElement;
    const upgrade = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "upgrade from all"
    ) as HTMLButtonElement;
    act(() => upgrade.click());

    expect(allTab.getAttribute("aria-pressed")).toBe("true");
    expect(
      container.querySelector('[data-testid="edit-host"]')?.textContent
    ).toBe("skill:upgrade");
  });

  it("closes an all-tab action when the active Space changes", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => ReactDOM.render(<MyAssetsPage />, container));

    const edit = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "edit from all"
    ) as HTMLButtonElement;
    act(() => edit.click());
    expect(
      container.querySelector('[data-testid="edit-host"]')?.textContent
    ).toBe("skill:edit");

    act(() => {
      for (const handler of [...spaceHandlers]) handler();
    });
    expect(
      container.querySelector('[data-testid="edit-host"]')?.textContent
    ).toBe("closed");
  });
});
