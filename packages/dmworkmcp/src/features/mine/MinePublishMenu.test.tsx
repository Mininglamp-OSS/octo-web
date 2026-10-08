// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getCategories: vi.fn(),
  track: vi.fn(),
  spaceHandlers: new Set<() => void>(),
}));

vi.mock("@octo/base", () => ({
  t: (key: string) => key,
  useI18n: () => undefined,
  Dap: { shared: { track: h.track } },
  WKApp: {
    mittBus: {
      on: (_event: string, handler: () => void) => h.spaceHandlers.add(handler),
      off: (_event: string, handler: () => void) =>
        h.spaceHandlers.delete(handler),
    },
  },
  WKButton: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@douyinfe/semi-ui", () => ({
  Toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@dmwork/skillmarket", () => ({
  getCategories: (...args: unknown[]) => h.getCategories(...args),
  BotPublishModal: ({ visible }: { visible: boolean }) =>
    visible ? <div data-testid="skill-bot-publish" /> : null,
  NewSkillModal: ({
    visible,
    categories,
  }: {
    visible: boolean;
    categories: unknown[];
  }) =>
    visible ? (
      <div
        data-testid="skill-manual-publish"
        data-categories={categories.length}
      />
    ) : null,
}));

vi.mock("../../components/McpBotPublishModal", () => ({
  default: ({ visible }: { visible: boolean }) =>
    visible ? <div data-testid="connector-bot-publish" /> : null,
}));

vi.mock("../../components/McpCreateModal", () => ({
  default: ({ visible }: { visible: boolean }) =>
    visible ? <div data-testid="connector-manual-publish" /> : null,
}));

vi.mock("../../components/ExpertBotPublishModal", () => ({
  default: ({ visible, kind }: { visible: boolean; kind: string }) =>
    visible ? <div data-testid={`expert-bot-publish-${kind}`} /> : null,
}));

import MinePublishMenu from "./MinePublishMenu";

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  h.getCategories.mockResolvedValue([{ id: "dev", name: "Development" }]);
  h.spaceHandlers.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  ReactDOM.unmountComponentAtNode(container);
  container.remove();
  h.spaceHandlers.clear();
});

function renderMenu() {
  act(() =>
    ReactDOM.render(<MinePublishMenu onChanged={vi.fn()} />, container)
  );
}

function click(testId: string) {
  act(() => {
    (
      container.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement
    ).click();
  });
}

describe("MinePublishMenu", () => {
  it("offers one entry with every supported type and publishing method", () => {
    renderMenu();
    click("mine-publish-entry");

    expect(container.querySelectorAll('[role="menuitem"]')).toHaveLength(6);
    expect(container.textContent).toContain("mcp.mine.publishSkillBot");
    expect(container.textContent).toContain("mcp.mine.publishSkillManual");
    expect(container.textContent).toContain("mcp.mine.publishConnectorBot");
    expect(container.textContent).toContain("mcp.mine.publishConnectorManual");
    expect(container.textContent).toContain("mcp.mine.publishExpertBot");
    expect(container.textContent).toContain("mcp.mine.publishSquadBot");
  });

  it("loads categories before opening the manual Skill flow", async () => {
    renderMenu();
    click("mine-publish-entry");
    await act(async () => {
      (
        container.querySelector(
          '[data-testid="mine-publish-skill-manual"]'
        ) as HTMLButtonElement
      ).click();
    });

    expect(h.getCategories).toHaveBeenCalledTimes(1);
    expect(
      container
        .querySelector('[data-testid="skill-manual-publish"]')
        ?.getAttribute("data-categories")
    ).toBe("1");
    expect(h.track).toHaveBeenCalledWith(
      "market_manual_publish_dialog_opened",
      { market_type: "skill" }
    );
  });

  it("does not let a stale category request replace a newer flow", async () => {
    let resolveCategories: (value: Array<{ id: string; name: string }>) => void =
      () => {};
    h.getCategories.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCategories = resolve;
      })
    );
    renderMenu();

    click("mine-publish-entry");
    click("mine-publish-skill-manual");
    click("mine-publish-entry");
    click("mine-publish-connector-manual");
    expect(
      container.querySelector('[data-testid="connector-manual-publish"]')
    ).not.toBeNull();

    await act(async () => {
      resolveCategories([{ id: "dev", name: "Development" }]);
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="connector-manual-publish"]')
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="skill-manual-publish"]')
    ).toBeNull();
    expect(h.track).toHaveBeenCalledTimes(1);
    expect(h.track).toHaveBeenCalledWith(
      "market_manual_publish_dialog_opened",
      { market_type: "mcp" }
    );
  });

  it("tracks the connector manual flow with the shared mcp market type", () => {
    renderMenu();
    click("mine-publish-entry");
    click("mine-publish-connector-manual");

    expect(h.track).toHaveBeenCalledWith(
      "market_manual_publish_dialog_opened",
      { market_type: "mcp" }
    );
  });

  it("opens Bot flows for experts and squads", () => {
    renderMenu();
    click("mine-publish-entry");
    click("mine-publish-expert-bot");
    expect(
      container.querySelector('[data-testid="expert-bot-publish-agent"]')
    ).not.toBeNull();

    act(() => {
      for (const handler of [...h.spaceHandlers]) handler();
    });
    expect(
      container.querySelector('[data-testid="expert-bot-publish-agent"]')
    ).toBeNull();

    click("mine-publish-entry");
    click("mine-publish-squad-bot");
    expect(
      container.querySelector('[data-testid="expert-bot-publish-squad"]')
    ).not.toBeNull();
  });
});
