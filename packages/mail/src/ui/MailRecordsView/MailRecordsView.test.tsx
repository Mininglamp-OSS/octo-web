// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MailRecordsView from ".";

const message = {
  id: "E1",
  mailbox: "Inbox",
  subject: "Status update",
  from: "sender@example.com",
  to: ["owner@example.com"],
  preview: "Hello",
  receivedAt: "2026-08-12T00:00:00Z",
  size: 128,
  keywords: [],
  unread: true,
};

describe("MailRecordsView", () => {
  afterEach(() => cleanup());

  it("does not expose selection controls without a bulk action", () => {
    render(
      <MailRecordsView
        mailboxes={[
          { id: "inbox", name: "Inbox", role: "inbox", total: 1, unread: 1 },
        ]}
        selectedMailbox="Inbox"
        selectedMessageId=""
        messages={[message]}
        total={1}
        page={1}
        pageCount={1}
        search=""
        unreadOnly={false}
        loading={false}
        error=""
        starringMessageIds={[]}
        locale="en-US"
        t={(key) => key}
        onRefresh={vi.fn()}
        onSearch={vi.fn()}
        onUnreadOnlyChange={vi.fn()}
        onSelectMessage={vi.fn()}
        onToggleStar={vi.fn()}
        onPage={vi.fn()}
      />
    );

    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "mail.actions.star" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "mail.status.unread" })
    ).toBeTruthy();
  });
});
