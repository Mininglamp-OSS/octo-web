// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { fireEvent, screen } from "@testing-library/dom";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@octo/base", () => ({
  useI18n: () => ({
    t: (key: string, options?: { values?: { name?: string } }) =>
      options?.values?.name ? `${key}:${options.values.name}` : key,
  }),
}));

vi.mock("../Service/AppBotService", () => ({
  default: {
    getAvailableBots: vi.fn(),
    applyBot: vi.fn(),
  },
}));

vi.mock("../features/AppBotAvatar", () => ({
  default: ({ uid }: { uid: string }) => React.createElement("span", null, uid),
}));

import AppBotService from "../Service/AppBotService";
import type { AppBotHostCapabilities } from "../host/types";
import AppsWorkspace from "../workspace/AppsWorkspace";

let container: HTMLDivElement;

function createHost(): AppBotHostCapabilities {
  return {
    getCurrentSpace: () => ({ id: "space-a", name: "Alpha" }),
    resolveSpaceName: async () => "Alpha",
    subscribeSpaceChanged: () => () => {},
    openConversation: vi.fn(async () => {}),
    clearConversation: vi.fn(),
    isOctoAssistant: () => false,
    track: vi.fn(),
  };
}

describe("AppsWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(AppBotService.getAvailableBots).mockResolvedValue([
      {
        id: "bot-1",
        uid: "robot_1",
        display_name: "Docs Bot",
        description: "Search docs",
        scope: "platform",
      },
    ]);
    vi.mocked(AppBotService.applyBot).mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => ReactDOM.unmountComponentAtNode(container));
    container.remove();
  });

  it("runs with a supplied host and delegates opening the selected bot", async () => {
    const host = createHost();

    await act(async () => {
      ReactDOM.render(<AppsWorkspace host={host} />, container);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Docs Bot/ }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(AppBotService.applyBot).toHaveBeenCalledWith("robot_1");
    expect(host.openConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "robot_1",
        channelType: 1,
        displayName: "Docs Bot",
      })
    );
  });
});
