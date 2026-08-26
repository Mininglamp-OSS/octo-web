import { describe, expect, it } from "vitest";
import {
  getMessageText,
  hasKeyword,
  isValidAgentMailboxLocalpart,
  splitAddresses,
} from "./utils";

describe("mail utilities", () => {
  it("splits recipient input without empty entries", () => {
    expect(
      splitAddresses("a@example.com, b@example.com;\nc@example.com")
    ).toEqual(["a@example.com", "b@example.com", "c@example.com"]);
  });

  it("matches protocol keywords case-insensitively", () => {
    expect(hasKeyword(["\\SEEN", "\\Flagged"], "\\seen")).toBe(true);
  });

  it.each([
    ["agent", true],
    ["support", true],
    ["agent.alerts_1", true],
    ["bot1", false],
    ["admin", false],
    ["POSTMASTER", false],
    ["agent..alerts", false],
    ["a".repeat(65), false],
  ] as const)("validates Agent mailbox name %s", (localpart, expected) => {
    expect(isValidAgentMailboxLocalpart(localpart)).toBe(expected);
  });

  it("prefers plain text bodies", () => {
    expect(
      getMessageText({
        id: "E1",
        mailbox: "Inbox",
        subject: "Subject",
        from: "sender@example.com",
        to: [],
        preview: "preview",
        receivedAt: "",
        size: 0,
        keywords: [],
        unread: false,
        bodyText: "plain body",
        bodyHtml: "<b>html body</b>",
      })
    ).toBe("plain body");
  });
});
