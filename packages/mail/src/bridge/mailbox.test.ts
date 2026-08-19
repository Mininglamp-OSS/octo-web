import { describe, expect, it } from "vitest";
import { findMailbox, inferMailboxRole } from "./mailbox";

describe("mailbox role helpers", () => {
  it("prefers the backend special-use role over a localized name", () => {
    expect(
      inferMailboxRole({
        id: "1",
        name: "已发送",
        role: "sent",
        total: 1,
        unread: 0,
      })
    ).toBe("sent");
  });

  it("keeps compatibility with older English mailbox responses", () => {
    expect(
      inferMailboxRole({ id: "2", name: "Drafts", total: 1, unread: 0 })
    ).toBe("drafts");
  });

  it("does not infer system behavior from a user mailbox substring", () => {
    expect(
      inferMailboxRole({
        id: "user-1",
        name: "Draft contracts",
        total: 1,
        unread: 0,
      })
    ).toBeUndefined();
    expect(
      inferMailboxRole({
        id: "user-2",
        name: "Archived Sent",
        total: 1,
        unread: 0,
      })
    ).toBeUndefined();
  });

  it("finds a mailbox by stable role", () => {
    const mailbox = findMailbox(
      [{ id: "3", name: "发件记录", role: "sent", total: 2, unread: 0 }],
      "sent"
    );
    expect(mailbox?.id).toBe("3");
  });
});
