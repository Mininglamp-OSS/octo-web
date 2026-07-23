// Docs right-pane embedded Bot DM shell (plan Task 5).
//
// Renders the REAL user↔bot Person DM inside the docs right pane using @octo/base's Conversation,
// wired with a one-shot initialCompose that auto-sends the HTML creation task exactly once. It does
// NOT jump to the global Chat module (no showConversation / switchToMenuById / openAppBotConversation),
// does NOT create a temporary/isolated channel, and never touches a Bot Token (plan §5.5).
//
// The right-pane owner (DocsHome) keeps the left DocsList resident; closing here just returns the
// pane to the docs empty state — it never deletes the DM.

import { useMemo, useState } from 'react'
import {
  Conversation,
  Channel,
  ChannelTypePerson,
  t,
  type InitialCompose,
  type InitialComposeState,
} from '../octoweb/index.ts'
import { buildHtmlCreationMessage, type HtmlCreationDraft } from './createHtmlTask.ts'

export interface DocsBotConversationProps {
  draft: HtmlCreationDraft
  /**
   * Whether this mount should auto-send the task exactly once. `true` only for the FIRST open of a
   * given requestId; on nav-reentry / restore DocsHome passes `false` so a remounted Conversation
   * (whose instance-level consumed-set was reset) only prefills the composer and never re-sends the
   * same task (plan Task 6 step 4 / §5 risk 1). Defaults to true.
   */
  autoSend?: boolean
  /** Close the chat and return the right pane to the docs empty state (does NOT delete the DM). */
  onClose(): void
  /** Fired after the initial task message is acknowledged as sent (drives list-refresh in DocsHome). */
  onMessageSent?(): void
}

/** Line-drawn close glyph (UI-SPEC: no unicode/emoji functional icons). */
function CloseIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

export function DocsBotConversation({
  draft,
  autoSend = true,
  onClose,
  onMessageSent,
}: DocsBotConversationProps) {
  const [composeState, setComposeState] = useState<InitialComposeState | null>(null)
  const [failReason, setFailReason] = useState<string | undefined>()

  // The REAL user↔bot Person channel (§1.0). Memoised on botUid so a re-render doesn't rebuild it.
  const channel = useMemo(
    () => new Channel(draft.botUid, ChannelTypePerson),
    [draft.botUid],
  )

  // The one-shot compose: fixed task text + staged files, auto-sent once (keyed by requestId).
  // Memoised on requestId + autoSend so a re-render passes the SAME object identity and the
  // Conversation's instance-level consumed-set dedupes correctly (§5 risk 1). Rebuilding the
  // message here is pure. On nav-reentry DocsHome passes autoSend=false → prefill only, no re-send.
  const compose: InitialCompose = useMemo(
    () => ({
      requestId: draft.requestId,
      text: buildHtmlCreationMessage(draft),
      files: draft.files,
      autoSend,
    }),
    [draft, autoSend],
  )

  // First letter of the bot name as an avatar fallback (WKAvatar isn't publicly exported; §Task5
  // step 2 permits a name-initial fallback rather than a deep host import).
  const avatarInitial = (draft.botName || draft.botUid).trim().charAt(0).toUpperCase()

  // Status line reflects ONLY the front-end IM lifecycle (prepared/sent/failed). Real bot
  // generation/publish progress is expressed by the bot's own messages, never faked here (§5.8).
  const statusText =
    composeState === 'failed'
      ? failReason || t('docs.list.htmlCreate.stateFailed')
      : composeState === 'sent'
        ? t('docs.list.htmlCreate.stateSent', { values: { name: draft.botName } })
        : composeState === 'prepared'
          ? t('docs.list.htmlCreate.statePrepared')
          : null

  return (
    <div className="octo-docs-bot-chat" data-screen-label="docs-bot-html-chat">
      <header className="octo-docs-bot-chat-header">
        <span className="octo-docs-bot-chat-avatar" aria-hidden="true">
          {avatarInitial}
        </span>
        <span className="octo-docs-bot-chat-heading">
          <span className="octo-docs-bot-chat-name">{draft.botName}</span>
          <span className="octo-docs-bot-chat-context">{t('docs.list.htmlCreate.chatContext')}</span>
        </span>
        <button
          type="button"
          className="octo-docs-bot-chat-close"
          aria-label={t('docs.list.htmlCreate.close')}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>

      {statusText && (
        <p
          className="octo-docs-bot-chat-status"
          role="status"
          data-state={composeState ?? undefined}
        >
          {statusText}
        </p>
      )}

      <div className="octo-docs-bot-chat-body">
        <Conversation
          key={channel.getChannelKey()}
          channel={channel}
          initialCompose={compose}
          onInitialComposeStateChange={(_requestId, state, reason) => {
            setComposeState(state)
            setFailReason(reason)
          }}
          onMessageSent={onMessageSent}
        />
      </div>
    </div>
  )
}
