import type { Mailbox } from "./types";

export type MailboxRole = NonNullable<Mailbox["role"]>;

export function inferMailboxRole(mailbox: Mailbox): MailboxRole | undefined {
  if (mailbox.role) return mailbox.role;
  const name = mailbox.name.toLowerCase();
  const legacyRoles: Partial<Record<string, MailboxRole>> = {
    inbox: "inbox",
    starred: "starred",
    sent: "sent",
    drafts: "drafts",
    trash: "trash",
    junk: "junk",
    spam: "junk",
    archive: "archive",
  };
  return legacyRoles[name];
}

export function findMailbox(
  mailboxes: Mailbox[],
  role?: MailboxRole,
  name?: string
): Mailbox | undefined {
  if (name) {
    const named = mailboxes.find((mailbox) => mailbox.name === name);
    if (named) return named;
  }
  if (role) {
    return mailboxes.find((mailbox) => inferMailboxRole(mailbox) === role);
  }
  return undefined;
}
