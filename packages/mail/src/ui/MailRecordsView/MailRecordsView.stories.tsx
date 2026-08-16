import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import MailRecordsView from ".";

const copy: Record<string, string> = {
  "mail.identity.connected": "Connected to OCTO",
  "mail.identity.loading": "Loading mailbox address",
  "mail.identity.unavailable": "Mailbox address unavailable",
  "mail.overview.total": "Total mail",
  "mail.overview.unread": "Unread",
  "mail.overview.sent": "Sent",
  "mail.records.received": "Received",
  "mail.records.sent": "Sent records",
  "mail.records.sender": "Sender",
  "mail.records.recipient": "Recipient",
  "mail.records.subject": "Subject",
  "mail.records.delivery": "Delivery",
  "mail.records.time": "Time",
  "mail.delivery.status.sending": "Sending",
  "mail.delivery.status.delivered": "Delivered",
  "mail.delivery.status.partially_delivered": "Partially delivered",
  "mail.delivery.status.not_delivered": "Not delivered",
  "mail.actions.search": "Search mail",
  "mail.actions.refresh": "Refresh",
  "mail.actions.compose": "Compose",
  "mail.actions.retry": "Retry",
  "mail.actions.previous": "Previous",
  "mail.actions.next": "Next",
  "mail.list.count": "3 messages",
  "mail.list.page": "Page 1",
  "mail.status.loading": "Loading mailbox…",
  "mail.empty.title": "No messages here",
  "mail.empty.description": "This mailbox is empty.",
  "mail.error.title": "Mailbox unavailable",
  "mail.noSubject": "No subject",
  "mail.unknownSender": "Unknown sender",
  "mail.unknownRecipient": "Unknown recipient",
};

const mailboxes = [
  { id: "1", name: "Inbox", role: "inbox" as const, total: 12, unread: 4 },
  { id: "2", name: "Sent", role: "sent" as const, total: 19, unread: 0 },
];

const meta = {
  title: "Mail/MailRecordsView",
  component: MailRecordsView,
  parameters: { layout: "fullscreen" },
  args: {
    mailboxes,
    selectedMailbox: "Inbox",
    selectedMessageId: "E1",
    messages: [
      {
        id: "E1",
        mailbox: "Inbox",
        subject: "Updated procurement quote for July",
        from: "avery@example.com",
        to: ["procurement@example.com"],
        preview:
          "The revised quote and delivery schedule are attached for review.",
        receivedAt: new Date().toISOString(),
        size: 4096,
        keywords: [],
        unread: true,
      },
      {
        id: "E2",
        mailbox: "Inbox",
        subject: "Contract review notes",
        from: "legal@example.com",
        to: ["procurement@example.com"],
        preview: "We completed the first pass and highlighted three items.",
        receivedAt: new Date(Date.now() - 86400000).toISOString(),
        size: 2048,
        keywords: [],
        unread: false,
      },
    ],
    total: 2,
    page: 1,
    pageCount: 1,
    search: "",
    unreadOnly: false,
    loading: false,
    error: "",
    starringMessageIds: [],
    locale: "en-US",
    t: (key: string) => copy[key] || key,
    onRefresh: () => undefined,
    onSearch: () => undefined,
    onUnreadOnlyChange: () => undefined,
    onSelectMessage: () => undefined,
    onToggleStar: () => undefined,
    onPage: () => undefined,
  },
} satisfies Meta<typeof MailRecordsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Received: Story = {};
export const Sent: Story = {
  args: {
    selectedMailbox: "Sent",
    selectedMessageId: "E11",
    messages: [
      {
        id: "E11",
        mailbox: "Sent",
        subject: "Supplier onboarding checklist",
        from: "procurement@example.com",
        to: ["supplier@example.com"],
        preview: "Here is the checklist for the onboarding process.",
        receivedAt: new Date().toISOString(),
        size: 2048,
        keywords: [],
        unread: false,
        delivery: { status: "delivered", delivered: 1, total: 1 },
      },
      {
        id: "E12",
        mailbox: "Sent",
        subject: "Quarterly delivery update",
        from: "procurement@example.com",
        to: ["buyer@example.com", "archive@example.com"],
        preview: "The quarterly delivery update is attached.",
        receivedAt: new Date(Date.now() - 3600000).toISOString(),
        size: 4096,
        keywords: [],
        unread: false,
        delivery: { status: "partially_delivered", delivered: 1, total: 2 },
      },
    ],
  },
};
export const Empty: Story = { args: { messages: [], total: 0 } };
export const Loading: Story = { args: { messages: [], loading: true } };
export const Error: Story = {
  args: { messages: [], error: "The mail service did not respond." },
};
