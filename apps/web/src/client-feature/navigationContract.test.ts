import { describe, expect, it } from "vitest";
import {
  assertConversationNavigation,
  isCompatibleConversationTarget,
  parseConversationTarget,
} from "./navigationContract";

describe("conversation navigation contract", () => {
  it.each([
    { channelId: "bot-a", channelType: 1, variant: "app-bot" },
    { channelId: "group-a", channelType: 2, variant: "workspace-group" },
  ])("parses compatible $variant targets", (input) => {
    expect(parseConversationTarget(input)).toEqual(input);
    expect(isCompatibleConversationTarget(input)).toBe(true);
    expect(() =>
      assertConversationNavigation("chat", "conversation", input)
    ).not.toThrow();
  });

  it.each([
    { channelId: "bot-a", channelType: 1, variant: "app-bot" },
    { channelId: "group-a", channelType: 2, variant: "workspace-group" },
  ])("rejects $variant targets in workspace presentation", (target) => {
    expect(() =>
      assertConversationNavigation("chat", "workspace", target)
    ).toThrow("Variant conversation target requires conversation presentation");
  });

  it("rejects a conversation target on contacts", () => {
    expect(() =>
      assertConversationNavigation("contacts", "conversation", {
        channelId: "group-a",
        channelType: 2,
      })
    ).toThrow("Conversation target requires chat");
  });

  it("rejects a variant with an incompatible channel type", () => {
    expect(() =>
      parseConversationTarget({
        channelId: "person-a",
        channelType: 1,
        variant: "workspace-group",
      })
    ).toThrow("Workspace-group variant requires channelType 2");
  });
});
