import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import MailSidebarView from ".";
import "./story.css";

const copy: Record<string, string> = {
  "mail.header.title": "Agent Mail",
  "mail.header.beta": "Beta",
  "mail.identity.connected": "Connected",
  "mail.identity.loading": "Loading mailbox address",
  "mail.identity.unavailable": "Mailbox address unavailable",
  "mail.identity.switchLabel": "Switch active mailbox",
  "mail.actions.compose": "Compose",
  "mail.actions.refresh": "Refresh",
  "mail.addresses.manage": "Manage mailbox addresses",
  "mail.navigation.records": "Mail folders",
  "mail.status.loading": "Loading mailbox…",
  "mail.mailbox.inbox": "Inbox",
  "mail.mailbox.sent": "Sent records",
  "mail.mailbox.drafts": "Drafts",
  "mail.mailbox.junk": "Junk",
  "mail.agentMailboxes.connected": "Connected",
  "mail.agentMailboxes.unconnected": "Agent not connected",
};

const meta = {
  title: "Mail/MailSidebarView",
  component: MailSidebarView,
  parameters: { layout: "fullscreen" },
  args: {
    mailboxes: [
      { id: "1", name: "Inbox", role: "inbox", total: 12, unread: 4 },
      { id: "2", name: "Sent", role: "sent", total: 19, unread: 0 },
      { id: "3", name: "Drafts", role: "drafts", total: 2, unread: 0 },
      { id: "4", name: "Junk", role: "junk", total: 1, unread: 0 },
    ],
    agentMailboxes: [
      {
        id: "11",
        address: "alice@demo.octo.test",
        agentName: "Frontend Agent",
        connectState: "connected",
      },
      {
        id: "12",
        address: "alice-bot@demo.octo.test",
        connectState: "unconnected",
      },
    ],
    selectedAgentMailbox: {
      id: "11",
      address: "alice@demo.octo.test",
      agentName: "Frontend Agent",
      connectState: "connected",
    },
    identity: { address: "procurement@example.com" },
    identityUnavailable: false,
    selectedMailbox: "Inbox",
    addressManagementActive: false,
    loading: false,
    error: "",
    t: (key: string) => copy[key] || key,
    onCompose: () => undefined,
    onManageAddresses: () => undefined,
    onRefresh: () => undefined,
    onSelectMailbox: () => undefined,
    onSelectAgentMailbox: () => undefined,
  },
  decorators: [
    (Story) => (
      <div className="octo-mail-story-frame">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MailSidebarView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const AddressManagement: Story = {
  args: { addressManagementActive: true },
};
export const Loading: Story = { args: { mailboxes: [], loading: true } };
export const Error: Story = {
  args: { mailboxes: [], error: "The mail service did not respond." },
};
