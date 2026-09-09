import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@octo/base", () => ({
  Conversation: ({ channel }: { channel: { channelID: string } }) =>
    <main data-channel={channel.channelID}>messages</main>,
}));
vi.mock("../features/AppBotAvatar", () => ({
  default: ({ uid }: { uid: string }) => <img alt={uid} />,
}));

import { renderAppBotConversation } from "../features/AppBotConversationView";
import type { Channel } from "wukongimjssdk";

describe("shared app conversation view", () => {
  it("preserves the Web header, avatar and conversation without a generic chat toolbar", () => {
    const channel = { channelID: "bot-1", getChannelKey: () => "bot-1-1" } as Channel;
    const markup = renderToStaticMarkup(renderAppBotConversation({
      channelId: "bot-1", displayName: "Docs Bot",
    }, channel));
    const root = document.createElement("div");
    root.innerHTML = markup;
    expect(root.querySelectorAll(".appbot-chat-header")).toHaveLength(1);
    expect(root.querySelector(".appbot-chat-header-name")?.textContent).toBe("Docs Bot");
    expect(root.querySelector("img")?.alt).toBe("bot-1");
    expect(root.querySelector("main")?.dataset.channel).toBe("bot-1");
    expect(root.querySelectorAll("button")).toHaveLength(0);
  });
});
