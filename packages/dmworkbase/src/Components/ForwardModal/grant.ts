// Forward-grant contract shared across the ForwardModal → useForwardModal → ConversationSelect
// → WKBase chain (feature #511 "forward doc to chat", frontend-design §2.3).
//
// The grant area is an OPT-IN extension of the generic forward flow: existing callers
// (Conversation / Chat / Summary) never pass a grant config, so nothing here changes their
// behaviour. Only the docs "forward to chat" entry opts in — it renders the 授权区 and widens
// the finished callback with a second `grant?` argument.

import type { Channel } from "wukongimjssdk"

/** Roles a forwarder may grant when forwarding a doc — no admin. */
export type ForwardGrantRole = "reader" | "commenter" | "writer"

/** Final principals attributed to one selected forwarding target. */
export interface ForwardGrantTargetPrincipals {
  channelID: string
  channelType: number
  /** Human recipients plus Bots that remain selected for this target. */
  uids: string[]
}

/** The grant selection emitted on confirm — undefined when the switch is off. */
export interface ForwardGrant {
  role: ForwardGrantRole
  /**
   * Final authorization principals grouped by the target that contributed them. WKBase intersects
   * this snapshot with the latest sendable targets before granting, so a group that becomes
   * disbanded after confirmation cannot leak access to its members or Bots.
   */
  principalsByTarget?: ForwardGrantTargetPrincipals[]
  /**
   * Bot uids the forwarder explicitly kept selected in the 授权区 Bot expander (feature: user+Bot
   * grants). Kept for legacy role/Bot callers that do not provide `principalsByTarget`; the normal
   * document-forward flow uses the target-scoped snapshot above.
   */
  botUids?: string[]
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
  /**
   * Bot expander state (feature: user+Bot grants). Present only when there is at least one Bot
   * created by a selected person; the 授权区 renders a per-person expandable list so the forwarder
   * can cancel individual Bots (default: all selected). Absent → no Bot row is shown (zero-Bot
   * compatible). Resolution failures remain not-ready, expose retry, and block confirmation.
   */
  bots?: ForwardBotSnapshot
}

/** One display group of Bots associated with a selected person, group, or direct Bot target. */
export interface ForwardBotCreatorGroup {
  /** Stable key: creator uid, `group:<channelID>`, or `direct:<botUid>`. */
  uid: string
  /** Display name for the creator, selected group, or directly selected Bot. */
  name: string
  /** Bots this person created, each with its current selected state. */
  bots: Array<{ uid: string; name: string; selected: boolean }>
}

/** Bot expander model the 授权区 renders (feature: user+Bot grants). */
export interface ForwardBotSnapshot {
  /**
   * Whether the async resolve has completed for the CURRENT target/space. False while loading (or
   * right after the target changed): callers must not carry any Bot until this is true, so a stale
   * or in-flight resolve can never confirm old Bots.
   */
  ready: boolean
  /** Resolve failed. Confirmation stays blocked until retry succeeds. */
  error?: boolean
  /** Retry the current target's Bot resolution after a recoverable failure. */
  retry?: () => void
  /** Distinct human uids in the resolved target snapshot ("N 人"). */
  peopleCount: number
  /** Currently-selected Bot count across all creators ("M Bot"). */
  botCount: number
  /** Bot groups by source, rendered as expandable rows. */
  groups: ForwardBotCreatorGroup[]
  /** Toggle one Bot's selected state. */
  toggleBot(uid: string): void
}

/** Per-run aggregate returned by the docs-injected grant executor (host aggregates N/M from it). */
export interface ForwardGrantResult {
  granted: number
  failed: number
  /** All uids that failed to be granted. */
  failures?: string[]
  /** Uids permanently rejected by the API contract (HTTP 400). */
  rejected?: string[]
}

/**
 * Payload the docs bridge injects so the HOST can orchestrate "先授权后发":
 *   1. modal resolves a target-scoped principal snapshot; host intersects it with sendable targets
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
  onResult?(result: {
    sent: number
    failed: number
    grantFailures?: string[]
    grantRejections?: string[]
  }): void
}
