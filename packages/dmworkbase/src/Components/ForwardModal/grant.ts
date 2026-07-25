// Forward-grant contract shared across the ForwardModal → useForwardModal → ConversationSelect
// → WKBase chain (feature #511 "forward doc to chat", frontend-design §2.3).
//
// The grant area is an OPT-IN extension of the generic forward flow: existing callers
// (Conversation / Chat / Summary) never pass a grant config, so nothing here changes their
// behaviour. Only the docs "forward to chat" entry opts in — it renders the 授权区 and widens
// the finished callback with a second `grant?` argument.

import type { Channel } from "wukongimjssdk"

/** Roles a forwarder may grant when forwarding a doc — no commenter / admin (AC-3 / AC-16). */
export type ForwardGrantRole = "reader" | "writer"

/** The grant selection emitted on confirm — undefined when the switch is off. */
export interface ForwardGrant {
  role: ForwardGrantRole
}

/**
 * Widened finished callback. The second `grant` arg is optional and backward compatible:
 * existing callers destructure only `channels` and ignore the extra argument.
 */
export type ForwardFinished = (channels: Channel[], grant?: ForwardGrant) => void

/**
 * Controlled config the caller passes to render the 授权区 inside ForwardModal. Present only
 * when the caller opts in; `undefined` → the授权区 is not rendered (既有转发路径零回归).
 */
export interface ForwardGrantConfig {
  /** Whether the current user may grant (canManage(role) || owner). Non-grantors see a disabled area. */
  canGrant: boolean
  /** Grey-out hint shown when canGrant is false (e.g. "仅文档管理员可在转发时授权"). */
  disabledReason?: string
  /** Whether the grant switch is on. Default off — the user must opt in to grant on forward. */
  enabled: boolean
  /** Selected grant role (default 'reader'). */
  role: ForwardGrantRole
  onEnabledChange(v: boolean): void
  onRoleChange(r: ForwardGrantRole): void
  /** "将授权给群当前 N 名成员" hint count, when a group target is selected. */
  targetMemberCount?: number
}

/** Per-run aggregate returned by the docs-injected grant executor (host aggregates N/M from it). */
export interface ForwardGrantResult {
  granted: number
  failed: number
  /** uids that failed to be granted (404 / 403), for the partial-failure hint. */
  failures?: string[]
}

/**
 * Payload the docs bridge injects so the HOST can orchestrate "先授权后发":
 *   1. host expands each target channel → uid snapshot (group via syncSubscribes, person → 对端 uid)
 *   2. if the grant switch is on, host `await`s `grantAccess(uids, role)` (docs owns the /docs api)
 *   3. host sends `**title**\n[title](link)` via WKSDK and aggregates sent/failed
 *   4. host calls `onResult` with the combined outcome
 *
 * The message send lives in the host because only `@octo/base` imports wukongimjssdk; the grant
 * lives in docs because only docs' apiClient routes `/docs/...` (frontend-design §7.2).
 */
export interface DocForwardOpen {
  /** Snapshot title used both as the bold line and the link text of the sent message. */
  messageTitle: string
  /** Clickable link with the docId embedded. */
  link: string
  /**
   * Whether to send this forward as a DocumentShareCard (type-18) rather than a plain-text link.
   * ONLY the "share document to chat" flow sets this true. Other forward entries that reuse this
   * bridge — notably the html-doc "让 AI 处理" AI-instruction forward — carry a docId but must stay
   * a plain-text message with their instruction-specific anchored link, so they leave this unset
   * (Jerry-Xin blocker: docId presence alone must NOT trigger the card conversion).
   */
  shareAsCard?: boolean
  /** docId — carried into the DocumentShareCard payload so the receiver can fetch an ACL-safe preview. */
  docId?: string
  /** The doc's space id (deep-link + preview both need it). */
  spaceId?: string
  /** Resource kind — doc/board/sheet — drives the card icon + which preview endpoint the cell calls. */
  kind?: "doc" | "board" | "sheet"
  /** Pre-resolved owner display name for the card eyebrow (optional). */
  ownerName?: string
  /** Pre-formatted "updated at" string for the card eyebrow (optional). */
  updatedAt?: string
  /** Precomputed by docs: canManage(role) || currentUid === ownerId. */
  canGrant: boolean
  /** Grey-out hint for non-grantors. */
  disabledReason?: string
  /** Default grant role when the switch is on (defaults to 'reader'). */
  defaultRole?: ForwardGrantRole
  /** docs-injected executor; host awaits it BEFORE sending (先授权后发). */
  grantAccess?(uids: string[], role: ForwardGrantRole): Promise<ForwardGrantResult>
  /** Optional outcome callback (host already toasts; docs may use this for extra UI). */
  onResult?(result: { sent: number; failed: number; grantFailures?: string[] }): void
}
