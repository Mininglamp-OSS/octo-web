import { describe, expect, it, vi } from "vitest";
import {
  resolveAgentMailboxBotNames,
  resolveBotDisplayName,
} from "./agentIdentity";

describe("Agent Mail Bot identity", () => {
  it("uses the canonical OCTO Bot name for display", async () => {
    const loadProfile = vi.fn().mockResolvedValue({ name: "本地测试1" });

    await expect(
      resolveBotDisplayName(
        "27qmz9ewbvf7e7c2390_bot",
        "local-profile",
        loadProfile
      )
    ).resolves.toBe("本地测试1");
    expect(loadProfile).toHaveBeenCalledWith("27qmz9ewbvf7e7c2390_bot");
  });

  it("uses the caller fallback when OCTO lookup fails", async () => {
    const loadProfile = vi.fn().mockRejectedValue(new Error("unavailable"));

    await expect(
      resolveBotDisplayName("bot-1", "untrusted-profile", loadProfile)
    ).resolves.toBe("untrusted-profile");
  });

  it("uses the caller fallback when OCTO returns an empty Profile name", async () => {
    const loadProfile = vi.fn().mockResolvedValue({ name: "  " });

    await expect(
      resolveBotDisplayName("bot-1", "Mailbox Bot", loadProfile)
    ).resolves.toBe("Mailbox Bot");
  });

  it("resolves only connected mailboxes carrying a Bot id", async () => {
    const loadProfile = vi.fn().mockResolvedValue({ name: "Review Bot" });
    const mailboxes = await resolveAgentMailboxBotNames(
      [
        {
          id: "1",
          address: "review@example.com",
          botId: "bot-1",
          agentName: "bot-1",
          connectState: "connected",
          outboundMode: "manual_confirmation",
        },
        {
          id: "2",
          address: "alerts@example.com",
          connectState: "unconnected",
          outboundMode: "manual_confirmation",
        },
      ],
      loadProfile
    );

    expect(mailboxes[0].agentName).toBe("Review Bot");
    expect(mailboxes[1].agentName).toBeUndefined();
    expect(loadProfile).toHaveBeenCalledTimes(1);
  });
});
