// @vitest-environment jsdom

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MailSidebarView from ".";

describe("MailSidebarView", () => {
  it("shows the Beta badge beside the Agent Mail title", () => {
    render(
      <MailSidebarView
        mailboxes={[]}
        agentMailboxes={[]}
        selectedAgentMailbox={null}
        identity={null}
        identityUnavailable={false}
        selectedMailbox=""
        addressManagementActive={false}
        loading={false}
        error=""
        t={(key) =>
          ({
            "mail.header.title": "Agent Mail",
            "mail.header.beta": "Beta",
            "mail.identity.loading": "Loading mailbox address",
            "mail.identity.switchLabel": "Switch active mailbox",
            "mail.actions.compose": "Compose",
            "mail.addresses.manage": "Manage Agent mailboxes",
          }[key] || key)
        }
        onCompose={() => undefined}
        onManageAddresses={() => undefined}
        onRefresh={() => undefined}
        onSelectMailbox={() => undefined}
        onSelectAgentMailbox={() => undefined}
      />
    );

    expect(screen.getByText("Agent Mail")).toBeTruthy();
    expect(screen.getByText("Beta").className).toContain(
      "octo-mail-sidebar__brand-beta"
    );
  });

  it("keeps the standard mailbox navigation visible when no Agent mailbox exists", () => {
    render(
      <MailSidebarView
        mailboxes={[]}
        agentMailboxes={[]}
        selectedAgentMailbox={null}
        identity={null}
        identityUnavailable
        selectedMailbox=""
        addressManagementActive
        loading={false}
        error=""
        t={(key) =>
          ({
            "mail.header.title": "Agent Mail",
            "mail.header.beta": "Beta",
            "mail.identity.unavailable": "Mailbox address unavailable",
            "mail.identity.switchLabel": "Switch active mailbox",
            "mail.actions.compose": "Compose",
            "mail.addresses.manage": "Manage Agent mailboxes",
            "mail.navigation.mailboxes": "Mailboxes",
            "mail.actions.refresh": "Refresh",
            "mail.mailbox.inbox": "Inbox",
            "mail.mailbox.starred": "Starred",
            "mail.mailbox.drafts": "Drafts",
            "mail.mailbox.sent": "Sent",
            "mail.mailbox.trash": "Trash",
            "mail.mailbox.junk": "Junk",
          }[key] || key)
        }
        onCompose={() => undefined}
        onManageAddresses={() => undefined}
        onRefresh={() => undefined}
        onSelectMailbox={() => undefined}
        onSelectAgentMailbox={() => undefined}
      />
    );

    for (const label of [
      "Inbox",
      "Starred",
      "Drafts",
      "Sent",
      "Trash",
      "Junk",
    ]) {
      expect(
        (screen.getByRole("button", { name: label }) as HTMLButtonElement)
          .disabled
      ).toBe(true);
    }
  });
});
