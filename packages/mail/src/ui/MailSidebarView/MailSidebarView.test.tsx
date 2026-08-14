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
});
