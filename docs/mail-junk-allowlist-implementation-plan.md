# Mail Junk Restore and Sender Allowlist

## Behavior checklist

- Show one `Not junk` action only while reading a message from the Junk mailbox.
- Ask for confirmation before changing the message or trusting the sender.
- Confirmation explains that the message returns to Inbox and the exact sender
  becomes trusted for the current mailbox.
- On success, remove the message from the current Junk list, clear/select the
  next message, and refresh mailbox counters.
- On failure, keep the current view and show the existing mail error treatment.
- Do not delete the message and do not expose this owner action to an Agent.

## File map

- `packages/mail/src/Service/MailService.ts`: owner WebAPI operation.
- `packages/mail/src/features/MessageDetailFeature.tsx`: action, confirmation,
  loading/error state, and success refresh.
- `packages/mail/src/features/MailRecordsFeature.tsx`: remove restored message
  from the current list and select the next item.
- `packages/mail/src/i18n/{zh-CN,en-US}.json`: user-visible copy.
- Co-located tests: request shape, visibility, confirmation, success, and error.

## PR scope

Only the Junk-detail restore-and-trust interaction is in scope. This does not
add a second mailbox navigation entry, change mail rendering, or alter other
message actions. A standalone allowlist settings screen can be added later if
manual entry/removal is needed.

## Verification plan

- Service test verifies the exact endpoint and mailbox context header.
- Component test verifies Junk-only visibility and no request before confirm.
- Component test verifies success callback/refresh and failure retention.
- Run the mail package tests, TypeScript check/build target, i18n check, and
  `git diff --check`.
