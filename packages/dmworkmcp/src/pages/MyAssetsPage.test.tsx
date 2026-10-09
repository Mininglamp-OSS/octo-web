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
  SkillListPage: ({ showPublishEntry }: { showPublishEntry?: boolean }) => {
    const [query, setQuery] = React.useState("");
    return React.createElement(
      "div",
      {
        "data-testid": "skills-page",
        "data-publish-entry": String(showPublishEntry),
      },
      React.createElement("input", {
        "data-testid": "skills-query",
        value: query,
        readOnly: true,
      }),
      React.createElement("button", {
        type: "button",
        "data-testid": "set-skills-query",
        onClick: () => setQuery("keep me"),
      })
    );
  },
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
              action: "bot-upgrade",
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

vi.mock("../features/mine/MinePublishMenu", () => ({
  default: ({ onChanged }: { onChanged: (type: "skills" | "mcp") => void }) =>
    React.createElement(
      React.Fragment,
      null,
      React.createElement(
        "button",
        { type: "button", "data-testid": "mine-publish-entry" },
        "publish"
      ),
      React.createElement("button", {
        type: "button",
        "data-testid": "skill-published",
        onClick: () => onChanged("skills"),
      }),
      React.createElement("button", {
        type: "button",
        "data-testid": "connector-published",
        onClick: () => onChanged("mcp"),
      })
    ),
}));

vi.mock("./McpMarketListPage", () => ({
  default: ({ showPublishEntry }: { showPublishEntry?: boolean }) =>
    React.createElement("div", {
      "data-testid": "mcp-page",
      "data-publish-entry": String(showPublishEntry),
    }),
}));
vi.mock("./ExpertMarketListPage", () => ({
  default: ({
    mineType,
    showPublishEntry,
  }: {
    mineType?: "agent" | "squad";
    showPublishEntry?: boolean;
  }) =>
    React.createElement("div", {
      "data-testid": `${mineType}-page`,
      "data-publish-entry": String(showPublishEntry),
    }),
}));

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
    ).toBe("skill:bot-upgrade");
  });

  it("keeps one page-level publish entry while switching type tabs", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => ReactDOM.render(<MyAssetsPage />, container));

    expect(
      container.querySelectorAll('[data-testid="mine-publish-entry"]')
    ).toHaveLength(1);
    expect(
      container
        .querySelector('[data-testid="mine-publish-entry"]')
        ?.closest(".wk-mcp-mine__tabs")
    ).not.toBeNull();
    expect(
      container
        .querySelector('[data-testid="mine-publish-entry"]')
        ?.closest(".wk-mcp-mine__hero-actions")
    ).toBeNull();
    const skillTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "skillMarket.plugin.typeSkill"
    ) as HTMLButtonElement;
    act(() => skillTab.click());

    expect(
      container.querySelectorAll('[data-testid="mine-publish-entry"]')
    ).toHaveLength(1);
    expect(
      container
        .querySelector('[data-testid="skills-page"]')
        ?.getAttribute("data-publish-entry")
    ).toBe("false");

    const assertTabKeepsLegacyEntryHidden = (
      label: string,
      pageTestId: string
    ) => {
      const tab = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === label
      ) as HTMLButtonElement;
      act(() => tab.click());
      expect(
        container
          .querySelector(`[data-testid="${pageTestId}"]`)
          ?.getAttribute("data-publish-entry")
      ).toBe("false");
      expect(
        container.querySelectorAll('[data-testid="mine-publish-entry"]')
      ).toHaveLength(1);
    };

    assertTabKeepsLegacyEntryHidden(
      "skillMarket.plugin.typeConnector",
      "mcp-page"
    );
    assertTabKeepsLegacyEntryHidden(
      "skillMarket.plugin.typeExpert",
      "agent-page"
    );
    assertTabKeepsLegacyEntryHidden(
      "skillMarket.plugin.typeExpertTeam",
      "squad-page"
    );
  });

  it("does not reset the active Skill tab after publishing a connector", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => ReactDOM.render(<MyAssetsPage />, container));

    const skillTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "skillMarket.plugin.typeSkill"
    ) as HTMLButtonElement;
    act(() => skillTab.click());

    act(() => {
      (container.querySelector('[data-testid="set-skills-query"]') as HTMLButtonElement).click();
    });
    act(() => {
      (container.querySelector('[data-testid="connector-published"]') as HTMLButtonElement).click();
    });

    expect((container.querySelector('[data-testid="skills-query"]') as HTMLInputElement).value).toBe("keep me");

    act(() => {
      (container.querySelector('[data-testid="skill-published"]') as HTMLButtonElement).click();
    });
    expect((container.querySelector('[data-testid="skills-query"]') as HTMLInputElement).value).toBe("");
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
