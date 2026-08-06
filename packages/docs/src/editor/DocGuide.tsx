import { useState, useRef, useEffect, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import {
  useI18n,
  fetchOwnedBots,
  getWKApp,
  Channel,
  ChannelTypePerson,
  forwardPlainText,
  canForwardToChat,
} from '../octoweb/index.ts'

/**
 * Which editor shell the guide was opened from. Drives the command list and which bundled skill
 * file the "where are the skills" section points at:
 *   doc   -> octo-docs skill, doc.md
 *   sheet -> octo-docs skill, sheet.md
 *   board -> octo-docs skill, board.md
 *   html  -> octo-html skill (a SEPARATE skill / backend from `docs`)
 */
export type DocGuideKind = 'doc' | 'sheet' | 'board' | 'html'

/**
 * How much of the document title may enter the forwarded prompt. Titles are unbounded (no maxLength
 * on the header input, no server clamp), and the prompt must fit in ONE chat message — so the one
 * user-controlled field in it is clamped. Generous enough that a real title is never cut.
 */
const DOC_TITLE_IN_PROMPT_MAX = 200

/**
 * Everything a <SectionHead> needs that lives in DocGuide's state. Passed as one object so the
 * component below can stay at module scope while still reading live state.
 */
type SectionHeadCtx = {
  copiedSection: string | null
  copySection: (id: string, text: string) => Promise<void> | void
  copyLabel: string
  copiedLabel: string
}

/**
 * Section heading with its own copy affordance. Each block of the guide is independently useful —
 * a user may want just the install commands, or just this document's ids — so each section carries a
 * copy button rather than forcing an all-or-nothing copy of the whole prompt.
 *
 * Declared at MODULE scope, not inside DocGuide. A component defined in the render body is a new
 * function identity on every render, so React unmounts and remounts the whole subtree instead of
 * updating it — which blows away focus on the copy button the moment `copiedSection` flips to show
 * the checkmark, i.e. exactly when a keyboard user has just pressed it.
 */
function SectionHead({
  id,
  label,
  text,
  ctx,
}: {
  id: string
  label: string
  text: string
  ctx: SectionHeadCtx
}): ReactElement {
  const isCopied = ctx.copiedSection === id
  return (
    <div className="octo-doc-guide-section-head">
      <h3>{label}</h3>
      <button
        type="button"
        className="octo-doc-guide-section-copy"
        data-testid={`doc-guide-copy-${id}`}
        aria-label={`${ctx.copyLabel} — ${label}`}
        title={isCopied ? ctx.copiedLabel : ctx.copyLabel}
        onClick={() => void ctx.copySection(id, text)}
      >
        {isCopied ? (
          <svg className="octo-doc-guide-glyph" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="4 13 9 18 20 6" />
          </svg>
        ) : (
          <svg className="octo-doc-guide-glyph" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h8" />
          </svg>
        )}
      </button>
    </div>
  )
}

/**
 * Length cap for the identifier field (`docId`). It comes straight off the URL query
 * (`resolveDocTarget`, DocsHome.tsx:167-201) with no shape check anywhere in the chain, so it is an
 * attacker-controlled string of unbounded length, not a trusted id. (`space` used to be capped here
 * too; it no longer reaches the prompt — a bot resolves its space server-side from its identity.)
 */
const DOC_IDENT_IN_PROMPT_MAX = 64

/**
 * Every physical line terminator, plus every control character, defined BY UNICODE PROPERTY rather
 * than by an enumerated list. Same rule as `encodeUserGoal` in html-create/createHtmlTask.ts, which
 * carries the identical invariant for the HTML task prompt:
 *
 *   - `\p{Cc}` — all C0 (U+0000–U+001F, incl. LF, CR, VT U+000B, FF U+000C) and C1 controls.
 *   - `\p{Zl}` / `\p{Zp}` — LINE SEPARATOR U+2028 / PARAGRAPH SEPARATOR U+2029.
 *   - `\u0085` (NEL) listed explicitly: it IS in `\p{Cc}`, kept visible because it is the one
 *     terminator JS's own `\s` does NOT match — the reason a `\s`-based collapse is insufficient
 *     here and would have gone falsely green.
 *   - `\p{Cf}` EXCEPT ZWJ — invisible format controls. These do not break the line, so they are not
 *     a structural escape; they are a DISPLAY-layer forgery. Measured: 8 of 9 (ZWSP U+200B, LRM/RLM,
 *     LRE U+202A, RLO U+202E, LRI U+2066, PDI U+2069, SHY U+00AD) survived the terminator-only rule;
 *     only BOM was already caught as whitespace. RLO in particular lets a title render in one visual
 *     order while the bot consumes another. ZWJ (U+200D) is carved out because it is legitimate text:
 *     folding it splits emoji sequences (`👨‍👩‍👧‍👦` → four separate glyphs), corrupting honest titles
 *     to no security gain — it cannot reorder or hide anything on its own.
 */
const PROMPT_UNSAFE = /[\p{Zl}\p{Zp}\p{Cc}\u0085]|(?!\u200d)[\p{Cf}]/gu

/**
 * Normalize an untrusted value on its way INTO the forwarded prompt.
 *
 * The prompt is an instruction stream a bot executes with the FORWARDER's own octo-cli credentials,
 * so every interpolated field is data, not copy. Three of them are attacker-reachable:
 *
 * - `docId` comes straight off the URL query (`resolveDocTarget`, DocsHome.tsx:167-201) with no
 *   shape check anywhere in the chain — forging through it needs no access to any document at all,
 *   just a crafted `?doc=` link.
 * - The title is writable by any `writer` on a shared doc, and the PATCH accepts terminators the
 *   header `<input>` cannot type.
 *
 * Each field is rendered as one `- Field: value` list item, so the ONE structural escape is emitting
 * a second PHYSICAL line: its line-start sits at the same nesting level as the guide's own `## `
 * headings and authoritative fields, and is then indistinguishable from them. Rather than enumerate
 * newlines (whack-a-mole — the previous `\s+` pass missed NEL outright), every terminator/control is
 * folded to a space by property, giving a STRUCTURAL single-physical-line guarantee.
 *
 * The clamp then restores the single-message length bound an unbounded field would void. `Array.from`
 * slices by CODE POINT, so a cut can never leave a lone surrogate in the message payload.
 */
const forPrompt = (value: string | undefined, max: number): string => {
  const singleLine = (value ?? '').replace(PROMPT_UNSAFE, ' ').replace(/\s+/gu, ' ').trim()
  return Array.from(singleLine).slice(0, max).join('')
}

/**
 * An identifier on its way into a backtick-fenced span. Sanitized as above, then stripped of the
 * fence character itself: a value containing a backtick would otherwise close the span early and
 * escape back out into instruction context. Opaque ids have no legitimate use for one.
 */
const forPromptIdent = (value: string | undefined): string =>
  forPrompt(value, DOC_IDENT_IN_PROMPT_MAX).replace(/`/g, '')

/**
 * As `forPromptIdent`, but with a caller-supplied clamp — for the title, which is fenced for the same
 * reason (its value must not close the span and escape into instruction context) but is bounded by a
 * different maximum. The stripped value is also what the PANEL renders, so the fence characters never
 * leak into the human-readable view either.
 */
const forPromptFenced = (value: string | undefined, max: number): string =>
  forPrompt(value, max).replace(/`/g, '')

/**
 * "Usage guide" (使用指导) — a book-icon IconButton in the document header that opens a right-side
 * drawer explaining how to DRIVE this document from octo-cli.
 *
 * Distinct from the list-level `OnboardingHelp` ("?"): that one hands the user a copyable prompt
 * that gets a bot CONNECTED. This one assumes you are connected and answers "now how do I work on
 * this doc/sheet/board/html page" — prerequisites, the commands for THIS surface, read-modify-write
 * practice, the errors people actually hit, and above all WHERE THE SKILL DOCS ARE and how to fetch
 * them (`octo-cli skills` / `skills <name>` / `skills --install <dir>`), since the bundled skill doc
 * is the version-accurate source this UI deliberately does not duplicate.
 *
 * Mounted in all four editor headers (EditorShell / SheetView / BoardShell / HtmlDocView), which
 * share the `.octo-doc-header-right` + `.octo-tb-btn` chrome, so one component keeps them identical.
 * Rendered through a portal with its own state, so it does not disturb each shell's mutually
 * exclusive history/comments/members drawer.
 */
export function DocGuide({
  kind,
  space,
  docId,
  title,
}: {
  kind: DocGuideKind
  space?: string
  /** The document the guide was opened from — embedded in the prompt so a bot can act on THIS doc. */
  docId?: string
  /** Current title, for human context in the prompt (the bot addresses the doc by docId). */
  title?: string
}): ReactElement {
  const { t } = useI18n()
  // Bot picker for "forward to bot". NOTE the roster requirement is owner-scoped ("bots I created"),
  // which is why the host's own conversation-select is NOT reused here: it lists every conversation,
  // not just the caller's own bots. The prompt itself is plain TEXT — that part IS sendable through
  // the host forward path (ForwardService takes a caller-built content), so if the roster constraint
  // is ever dropped, this picker can go away. Once a bot is chosen we open a direct-message channel
  // with it and hand the prompt to the host conversation as a one-shot compose — the same seam the
  // "new HTML" flow uses, minus its `setSelectedDocId(null)`: the guide must never close the
  // document you are editing.
  const [bots, setBots] = useState<Array<{ uid: string; name: string }>>([])
  // Roster fetch lifecycle, so the picker can tell "still loading" and "request failed" apart from
  // the genuine "你没有 bot" empty state.
  const [botsState, setBotsState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [picking, setPicking] = useState(false)
  const [botQuery, setBotQuery] = useState('')
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  // The bot the prompt was last forwarded to, purely for the status line's name.
  const [forwardTarget, setForwardTarget] = useState<{ uid: string; name: string } | null>(null)
  const [sendState, setSendState] = useState<'sending' | 'sent' | 'failed' | null>(null)
  // Self-contained trigger + dialog: the entry point is a labelled button in the document header,
  // alongside 评论 / 转发到聊天 / 成员 (owner decision 2026-08-05 — the ≡ menu was too hidden).
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [copied, setCopied] = useState(false)
  // Which section's copy button last succeeded, so only THAT one shows its confirmation.
  const [copiedSection, setCopiedSection] = useState<string | null>(null)
  const sectionTimer = useRef<number | null>(null)
  const copiedTimer = useRef<number | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const pickerRef = useRef<HTMLDivElement | null>(null)
  // Guards against a second forward starting while one is still in flight (the button is disabled,
  // but a fast double-activate could otherwise slip through between renders).
  const sendingRef = useRef(false)
  // Latest close() for the document-level keydown listener, so the listener registers once per open
  // instead of re-subscribing on every render.
  const closeFnRef = useRef<() => void>(() => {})

  const close = () => {
    setOpen(false)
    // Drop any completed forward with the dialog so a stale "已发送给 xxx" does not greet the next
    // open. Nothing else to undo: the send is a single fire-and-forget host call — there is no
    // composer holding our text and therefore no draft to clean up.
    setForwardTarget(null)
    setSendState(null)
    setPicking(false)
    // Return focus to the trigger so keyboard users are not dropped onto <body>.
    triggerRef.current?.focus()
  }
  closeFnRef.current = close

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        // The bot picker sits ON TOP of the guide dialog, so Escape must dismiss the picker first
        // instead of tearing down the dialog underneath it (which would leave the picker orphaned).
        if (pickerRef.current) {
          setPicking(false)
          return
        }
        closeFnRef.current()
        return
      }
      // Minimal focus containment: if Tab has walked focus out of the panel, pull it back to the
      // close button rather than letting it escape into the (visually covered) document behind.
      // While the picker is up it owns focus, so leave containment to it.
      if (
        e.key === 'Tab' &&
        !pickerRef.current &&
        panelRef.current &&
        !panelRef.current.contains(document.activeElement)
      ) {
        e.preventDefault()
        closeRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  /**
   * Forward the prompt to one bot.
   *
   * Uses the host's own forward path (`forwardPlainText` -> ForwardService.send), the same mechanism
   * behind 转发到聊天. The previous implementation mounted a whole hidden `Conversation` just to
   * borrow its one-shot autoSend, which made the guide responsible for a composer it did not own —
   * the source of the draft-poisoning, cross-talk and unread-swallowing defects that each needed its
   * own patch. A direct send has none of that surface: no composer, no draft, no channel takeover.
   */
  const forwardTo = async (bot: { uid: string; name: string }) => {
    if (sendingRef.current) return
    sendingRef.current = true
    setForwardTarget(bot)
    setSendState('sending')
    try {
      const result = await forwardPlainText(
        [new Channel(bot.uid, ChannelTypePerson)],
        promptText,
        { spaceId: space ?? getWKApp().shared?.currentSpaceId ?? null },
      )
      // ForwardService reports per-target outcomes rather than throwing on a partial failure, so a
      // non-zero failedTargets is a real failure even though the promise resolved.
      setSendState(result.failedTargets > 0 ? 'failed' : 'sent')
    } catch {
      setSendState('failed')
    } finally {
      sendingRef.current = false
    }
  }

  // The command block for the surface the guide was opened from.
  const commands = t(`docs.guide.cmd.${kind}`)
  // Which bundled skill doc to read for this surface.
  const skillFile = t(`docs.guide.skillFile.${kind}`)

  /**
   * The forwardable/copyable prompt: the same guidance the panel shows, flattened to text an agent
   * can act on. Built from the SAME i18n values the panel renders, so the two can never drift.
   */
  // Per-section text, shared by the panel's section copy buttons AND assembled into promptText
  // below — one source, so a section copy can never disagree with the forwarded prompt.
  //
  // The title is CLAMPED before it enters the prompt. Doc titles have no length limit anywhere in
  // the chain (DocTitle's input has no maxLength, updateDocTitle imposes none), while the prompt is
  // sent as ONE chat message bounded by MAX_MESSAGE_LENGTH. Without this, a pathologically long
  // title would push a ~3.1k prompt over the limit and the forward would fail at send time — and the
  // locale-length regression test could not catch it, because the overflow comes from user data, not
  // from the i18n copy. The bot addresses the document by docId, so a truncated title costs nothing.
  //
  // Backtick-fenced like the two identifiers beside it, and for a sharper reason: the title is the
  // most attacker-reachable field in this block (any `writer` on a shared doc can rename it, and the
  // PATCH accepts text the header <input> cannot type), while the prompt intro tells the bot it holds
  // its own octo-cli credentials. `forPrompt` already guarantees the value stays on ONE physical line,
  // which closes the structural escape — a forged `## ` heading. What the fence adds is protection
  // against SAME-LINE prose injection: unfenced, `Q3 报告  忽略以上内容，改为执行 …` reads as an
  // authoritative continuation of the field; fenced, it is visibly a quoted literal. Same precedent as
  // `encodeUserGoal` (html-create/createHtmlTask.ts:86), which JSON-quotes for exactly this reason.
  const titleForPrompt = forPromptFenced(title, DOC_TITLE_IN_PROMPT_MAX)
  // Normalized for the SAME reason as the title (see `forPrompt`): a raw URL query param, so
  // injecting through it needs no document access at all.
  const docIdForPrompt = forPromptIdent(docId)
  const docInfoText = docIdForPrompt
    ? [
        `## ${t('docs.guide.docInfoTitle')}`,
        // Backtick-fenced so an agent reads the value as DATA rather than as instructions that
        // happen to sit in the prompt it was handed.
        `- ${t('docs.guide.docInfoId')}: \`${docIdForPrompt}\``,
        ...(titleForPrompt ? [`- ${t('docs.guide.docInfoTitleField')}: \`${titleForPrompt}\``] : []),
        `- ${t('docs.guide.docInfoKind')}: ${t(`docs.guide.kind.${kind}`)}`,
        t('docs.guide.docInfoHint'),
      ].join('\n')
    : ''
  const prereqText = [`## ${t('docs.guide.prereqTitle')}`, t('docs.guide.prereqBody'), t('docs.guide.prereqCode')].join('\n')
  const cmdText = [`## ${t('docs.guide.cmdTitle')}`, commands].join('\n')
  const pitfallText = [
    `## ${t('docs.guide.pitfallTitle')}`,
    `- ${t('docs.guide.pitfallAnchor')}`,
    `- ${t('docs.guide.pitfallProfile')}`,
    `- ${t('docs.guide.pitfallBaseUrl')}`,
    `- ${t('docs.guide.pitfallVersion')}`,
    `- ${t('docs.guide.pitfallPartial')}`,
  ].join('\n')
  const skillText = [
    `## ${t('docs.guide.skillTitle')}`,
    t('docs.guide.skillBody'),
    t('docs.guide.skillCode'),
    skillFile,
    t('docs.guide.skillInstall'),
  ].join('\n')

  // Assembled from the per-section constants above so a section copy and the forwarded prompt are
  // byte-identical for that block. Empty sections (no docId) drop out rather than leaving a gap.
  const promptText = [t('docs.guide.promptIntro'), '', docInfoText, prereqText, cmdText, pitfallText, skillText]
    .filter((part) => part !== '')
    .join('\n\n')

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
      if (sectionTimer.current !== null) window.clearTimeout(sectionTimer.current)
    },
    [],
  )

  const copyPrompt = async () => {
    // Only claim success when a real clipboard write resolved: `?.writeText` on a missing API
    // resolves to undefined, which would otherwise flash a false "copied".
    const writeText = navigator.clipboard?.writeText
    if (typeof writeText !== 'function') return
    try {
      await navigator.clipboard.writeText(promptText)
      setCopied(true)
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Denied: the prompt stays on screen, so the user can still select and copy it manually.
    }
  }

  /**
   * Copy one section's text. Same honesty rule as the whole-prompt copy: only report success when a
   * real clipboard write resolved (`?.writeText` on a missing API resolves to undefined).
   */
  const copySection = async (id: string, text: string) => {
    const writeText = navigator.clipboard?.writeText
    if (typeof writeText !== 'function') return
    try {
      await navigator.clipboard.writeText(text)
      setCopiedSection(id)
      if (sectionTimer.current !== null) window.clearTimeout(sectionTimer.current)
      sectionTimer.current = window.setTimeout(() => setCopiedSection(null), 2000)
    } catch {
      // Denied: the section text is on screen and selectable, so manual copy still works.
    }
  }

  // Bound once per render and spread into every <SectionHead>, so the module-level component stays
  // a stable identity (see the note on its declaration) without every call site repeating four props.
  const sectionHeadCtx: SectionHeadCtx = {
    copiedSection,
    copySection,
    copyLabel: t('docs.guide.copySection'),
    copiedLabel: t('docs.guide.copied'),
  }

  const openBotPicker = async () => {
    // Reset per-open picker state: a stale selection or search term from a previous open must not
    // leak into this one (and `loading` prevents the empty-state copy flashing before the fetch).
    setSelectedUid(null)
    setBotQuery('')
    setBotsState('loading')
    setBots([])
    setPicking(true)
    try {
      // The roster is "bots I CREATED" — owner dimension only (owner decision, revised 2026-07-28:
      // the earlier friend ∪ owner union is no longer wanted). `owned_bots` is exactly
      // `creator_uid = me`, active, in THIS space; a friended bot created by someone else is
      // deliberately NOT listed any more.
      const spaceId = space ?? getWKApp().shared?.currentSpaceId ?? ''
      const owned = spaceId ? await fetchOwnedBots(spaceId) : []
      setBots(owned.map((b) => ({ uid: b.uid, name: b.name })))
      setBotsState('ready')
    } catch {
      // Distinguish "the request failed" from "you have no bots": reporting an outage as an empty
      // roster sends the user hunting for a bot they already have.
      setBots([])
      setBotsState('failed')
    }
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className="octo-tb-btn octo-doc-guide-btn"
        data-testid="doc-guide-btn"
        aria-label={t('docs.guide.open')}
        title={t('docs.guide.open')}
        onClick={() => setOpen(true)}
      >
        {/* Book glyph — a real SVG icon (UI-SPEC: never emoji / Unicode characters as icons). */}
        <svg
          className="octo-doc-guide-glyph"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 1 4 16V5.5Z" />
          <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 0 20 16V5.5Z" />
        </svg>
        {/* Labelled like its siblings (评论 / 转发到聊天 / 成员): an unlabelled glyph read as
            decoration and users did not realise it was an entry point. */}
        <span className="octo-doc-guide-btn-label">{t('docs.guide.open')}</span>
      </button>
      {open &&
        createPortal(
          <div
            className="octo-doc-guide-overlay"
            data-testid="doc-guide-overlay"
            role="presentation"
            onClick={close}
          >
            <div
              className="octo-doc-guide-dialog"
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label={t('docs.guide.title')}
              onClick={(e) => e.stopPropagation()}
            >
              <header className="octo-doc-guide-header">
                <h2 className="octo-doc-guide-title">{t('docs.guide.title')}</h2>
                <button
                  type="button"
                  ref={closeRef}
                  className="octo-doc-guide-close"
                  aria-label={t('docs.guide.close')}
                  onClick={close}
                >
                  <svg
                    className="octo-doc-guide-glyph"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <line x1="6" y1="6" x2="18" y2="18" />
                    <line x1="18" y1="6" x2="6" y2="18" />
                  </svg>
                </button>
              </header>

              <div className="octo-doc-guide-body" data-testid="doc-guide-body">
                {/* 0. Which document this is. The commands below all take a <docId>; showing it here
                       means the user can read it off the panel, and it is the same value embedded in
                       the forwarded/copied prompt (one source, so the two cannot drift). */}
                {docIdForPrompt && (
                  <section className="octo-doc-guide-section" data-testid="doc-guide-docinfo">
                    <SectionHead id="docinfo" label={t('docs.guide.docInfoTitle')} text={docInfoText} ctx={sectionHeadCtx} />
                    <dl className="octo-doc-guide-meta">
                      <dt>{t('docs.guide.docInfoId')}</dt>
                      {/* The NORMALIZED value, same as the prompt embeds. Rendering the raw one here
                          would break the "panel and prompt cannot disagree" guarantee — and it is
                          exactly how a newline-bearing id hid itself: the panel collapses newlines
                          visually while the prompt carried the break-out. */}
                      <dd><code>{docIdForPrompt}</code></dd>
                      {titleForPrompt && (
                        <>
                          <dt>{t('docs.guide.docInfoTitleField')}</dt>
                          {/* Same normalized/truncated value the prompt embeds. */}
                          <dd>{titleForPrompt}</dd>
                        </>
                      )}
                      <dt>{t('docs.guide.docInfoKind')}</dt>
                      <dd>{t(`docs.guide.kind.${kind}`)}</dd>
                    </dl>
                    <p>{t('docs.guide.docInfoHint')}</p>
                  </section>
                )}

                {/* 1. Prerequisites — nothing below works until the CLI is installed and bound. */}
                <section className="octo-doc-guide-section">
                  <SectionHead id="prereq" label={t('docs.guide.prereqTitle')} text={prereqText} ctx={sectionHeadCtx} />
                  <p>{t('docs.guide.prereqBody')}</p>
                  <pre className="octo-doc-guide-code">{t('docs.guide.prereqCode')}</pre>
                </section>

                {/* 2. The commands for THIS surface (doc / sheet / board / html). */}
                <section className="octo-doc-guide-section">
                  <SectionHead id="cmd" label={t('docs.guide.cmdTitle')} text={cmdText} ctx={sectionHeadCtx} />
                  <pre className="octo-doc-guide-code" data-testid="doc-guide-commands">
                    {commands}
                  </pre>
                </section>

                {/* 3. The failures people actually hit, with the fix rather than just the symptom.
                       The former "best practice" section was dropped as owner-noise, but two of its
                       rules are NOT recoverable from an error message and so live on as pitfalls:
                       re-read on a version conflict, and — the one no failure ever teaches, because a
                       wholesale rewrite SUCCEEDS — send only what you changed, or the bot silently
                       destroys every comment anchor and live cursor in the document. */}
                <section className="octo-doc-guide-section">
                  <SectionHead id="pitfall" label={t('docs.guide.pitfallTitle')} text={pitfallText} ctx={sectionHeadCtx} />
                  <ul className="octo-doc-guide-list">
                    <li>{t('docs.guide.pitfallAnchor')}</li>
                    <li>{t('docs.guide.pitfallProfile')}</li>
                    <li>{t('docs.guide.pitfallBaseUrl')}</li>
                    <li>{t('docs.guide.pitfallVersion')}</li>
                    <li>{t('docs.guide.pitfallPartial')}</li>
                  </ul>
                </section>

                {/* 4. THE important one: where the skill docs live and how to get them. */}
                <section className="octo-doc-guide-section octo-doc-guide-section-skills">
                  <SectionHead id="skill" label={t('docs.guide.skillTitle')} text={skillText} ctx={sectionHeadCtx} />
                  <p>{t('docs.guide.skillBody')}</p>
                  <pre className="octo-doc-guide-code">{t('docs.guide.skillCode')}</pre>
                  <p className="octo-doc-guide-callout" data-testid="doc-guide-skill-file">
                    {skillFile}
                  </p>
                  <p>{t('docs.guide.skillInstall')}</p>
                </section>
              </div>

              {/* Footer actions, mirroring the "new HTML" modal: a secondary copy action plus the
                  primary forward. The prompt is built from the same i18n values the body renders. */}
              {/* Forward outcome. The send itself is a single host call (forwardPlainText), so there
                  is nothing to mount here — just the status the user reads. */}
              {forwardTarget && (
                <p
                  className="octo-doc-guide-sendstatus"
                  data-testid="doc-guide-sendstatus"
                  data-state={sendState ?? 'sending'}
                  role="status"
                >
                  {sendState === 'sent'
                    ? t('docs.guide.sentTo', { values: { name: forwardTarget.name } })
                    : sendState === 'failed'
                      ? t('docs.guide.sendFailed')
                      : t('docs.guide.sending', { values: { name: forwardTarget.name } })}
                </p>
              )}

              <footer className="octo-doc-guide-footer">
                <div className="octo-doc-guide-footer-actions">
                  <button
                    type="button"
                    className="octo-tb-btn"
                    data-testid="doc-guide-copy"
                    onClick={() => void copyPrompt()}
                  >
                    {copied ? t('docs.guide.copied') : t('docs.guide.copyPrompt')}
                  </button>
                  {/* The forward action is gated on the host actually being able to deliver; copy and
                      the panel itself stay ungated (reading a guide needs no IM runtime).

                      Why gate, and why on THIS predicate: our send path is
                      forwardPlainText -> ForwardService.send -> WKSDK.chatManager.send, which does NOT
                      touch showConversationSelect — so canForwardToChat() is not being used here for
                      its literal name. It is used because it is the accurate proxy for "WKBase is
                      mounted", and WKBase is what the whole IM runtime hangs off: the socket is only
                      ever dialed by <ConnectionStatus> (reconnectImWhenNotConnected, the sole
                      connectManager.connect() caller in the repo), which lives in the in-shell NavRail.
                      On standalone /d/:docId the host Layout early-returns StandaloneDocPage BEFORE
                      the WKBase subtree (apps/web/src/Layout/index.tsx:451-461), so no WKBase, no
                      ConnectionStatus, no socket.

                      And an unconnected send is silently lost, not rejected — traced through the
                      installed SDK rather than assumed: ChatManager.sendWithOptions resolves the
                      Message unconditionally (no connect-state check), sendSendPacket only pushes onto
                      sendPacketQueue, and the flush calls ConnectManager.send which is
                      `this.ws?.send(data)` — with no socket the optional chain swallows the write. So
                      ForwardService reports success and the user is told "Sent to X" for a message that
                      never left the tab. That is the false-success case, which is exactly what the
                      failedTargets > 0 test already treats as unacceptable. */}
                  {canForwardToChat() && (
                    <button
                      type="button"
                      className="octo-tb-btn octo-doc-guide-forward"
                      data-testid="doc-guide-forward"
                      // No second forward while one is in flight. Gate on the SEND state, not on
                      // "target set but state still unset": those two are assigned in the same batch,
                      // so that pair never renders and the button was never actually disabled — the
                      // `sendingRef` guard was silently carrying the whole invariant, dropping the
                      // second click with no feedback at all. A settled send (sent/failed) is
                      // re-forwardable as before.
                      disabled={sendState === 'sending'}
                      onClick={() => void openBotPicker()}
                    >
                      {t('docs.guide.forwardToBot')}
                    </button>
                  )}
                </div>
                <p className="octo-doc-guide-footer-hint">{t('docs.guide.footerHint')}</p>
              </footer>
            </div>
          </div>,
          document.body,
        )}

      {/* Bot picker — a proper selection modal (avatar + name + AI tag + search + Cancel/Confirm),
          modelled on the host's "forward to chat" dialog rather than a row of bare text buttons.
          Source is `GET /robot/owned_bots` via fetchOwnedBots(): the bots the caller CREATED,
          active, in this space (owner dimension only — a friended bot owned by someone else is
          deliberately not listed). */}
      {picking &&
        createPortal(
          <div
            className="octo-doc-guide-picker-overlay"
            data-testid="doc-guide-picker"
            role="presentation"
            onClick={() => setPicking(false)}
          >
            <div
              className="octo-doc-guide-picker"
              ref={pickerRef}
              role="dialog"
              aria-modal="true"
              aria-label={t('docs.guide.pickBotTitle')}
              onClick={(e) => e.stopPropagation()}
            >
              <header className="octo-doc-guide-picker-head">
                <h3 className="octo-doc-guide-picker-title">{t('docs.guide.pickBotTitle')}</h3>
                <button
                  type="button"
                  className="octo-doc-guide-close"
                  aria-label={t('docs.guide.close')}
                  onClick={() => setPicking(false)}
                >
                  <svg className="octo-doc-guide-glyph" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                    <line x1="6" y1="6" x2="18" y2="18" />
                    <line x1="18" y1="6" x2="6" y2="18" />
                  </svg>
                </button>
              </header>

              <div className="octo-doc-guide-picker-search">
                <input
                  className="octo-doc-guide-picker-input"
                  type="search"
                  value={botQuery}
                  placeholder={t('docs.guide.searchBot')}
                  onChange={(e) => setBotQuery(e.target.value)}
                />
              </div>

              <div className="octo-doc-guide-picker-list">
                {(() => {
                  if (botsState === 'loading') {
                    return <p className="octo-doc-guide-picker-empty">{t('docs.guide.loadingBots')}</p>
                  }
                  if (botsState === 'failed') {
                    return <p className="octo-doc-guide-picker-empty">{t('docs.guide.botsFailed')}</p>
                  }
                  const q = botQuery.trim().toLowerCase()
                  const shown = q ? bots.filter((b) => b.name.toLowerCase().includes(q)) : bots
                  if (shown.length === 0) {
                    return <p className="octo-doc-guide-picker-empty">{t('docs.guide.noBots')}</p>
                  }
                  return shown.map((b) => (
                    <button
                      key={b.uid}
                      type="button"
                      className={
                        selectedUid === b.uid
                          ? 'octo-doc-guide-picker-row is-selected'
                          : 'octo-doc-guide-picker-row'
                      }
                      aria-pressed={selectedUid === b.uid}
                      onClick={() => setSelectedUid(b.uid)}
                    >
                      {/* Avatar placeholder: first character of the display name, tinted per-uid so
                          rows stay distinguishable without fetching avatar images. `owned_bots`
                          returns no avatar field (OwnedBotLite = uid/name/description?), so there is
                          nothing to branch on — an <img> path here would be dead code. */}
                      <span className="octo-doc-guide-picker-avatar" aria-hidden="true">
                        {b.name.slice(0, 1)}
                      </span>
                      <span className="octo-doc-guide-picker-name">{b.name}</span>
                      <span className="octo-doc-guide-picker-tag">AI</span>
                    </button>
                  ))
                })()}
              </div>

              <footer className="octo-doc-guide-picker-foot">
                <button type="button" className="octo-tb-btn" onClick={() => setPicking(false)}>
                  {t('docs.guide.cancel')}
                </button>
                <button
                  type="button"
                  className="octo-tb-btn octo-doc-guide-forward"
                  data-testid="doc-guide-picker-confirm"
                  disabled={!selectedUid}
                  onClick={() => {
                    const hit = bots.find((b) => b.uid === selectedUid)
                    if (!hit) return
                    setPicking(false)
                    void forwardTo(hit)
                  }}
                >
                  {t('docs.guide.confirm')}
                </button>
              </footer>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
