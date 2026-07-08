import { EditorContent } from '@tiptap/react'
import { useCollabEditor } from '../collab/useCollabEditor.ts'
import type { CollabEditorOptions } from '../collab/createCollabEditor.ts'
import { canManage } from '../auth/roles.ts'
import { Toolbar, EditorBubbleMenu } from './Toolbar.tsx'
import { Outline } from './Outline.tsx'
import { StatusBar } from './StatusBar.tsx'
import { PresenceBar } from './PresenceBar.tsx'
import { MemberPanel } from '../members/MemberPanel.tsx'
import { VersionPanel } from '../versions/VersionPanel.tsx'
import { CommentPanel } from '../comments/CommentPanel.tsx'
import { CommentBubble } from '../comments/CommentBubble.tsx'
import { useDocComments } from '../comments/useDocComments.ts'
import { useCommentHighlights } from '../comments/useCommentHighlights.ts'
import { useDocDelete } from './useDocDelete.ts'
import { useMemberNames } from '../members/useMemberNames.ts'
import { exportDocToMarkdown, type MdNode } from '../export/markdown.ts'
import { emojiGlyph } from './emoji.ts'
import { colorFromId } from '../awareness/presence.ts'
import { useEffect, useState, useRef, useCallback, type ReactNode } from 'react'
import { t } from '../octoweb/index.ts'
import { getCurrentUid, canForwardToChat } from '../octoweb/index.ts'
import { getDoc, getUserName, updateDocTitle } from '../pages/docsApi.ts'
import { startDocForward } from '../forward/startDocForward.ts'
import { RequestAccessButton } from '../access-request/RequestAccessButton.tsx'
import { useAccessRequests } from '../access-request/useAccessRequests.ts'
import { DocTerminal } from './DocTerminal.tsx'
import {
  DocMoreMenu,
  OpenNewPageIcon,
  HistoryIcon,
  ExportIcon,
  DeleteIcon,
  type DocMoreMenuItem,
} from './DocMoreMenu.tsx'
import { ConfirmModal } from './ConfirmModal.tsx'
import './styles.css'

/** Which right-side drawer panel is open (mutually exclusive); null = drawer closed. */
type DrawerPanel = 'history' | 'comments' | 'members' | null

export interface EditorShellProps extends CollabEditorOptions {
  title: string
  /** Optional "back to the document list" handler — renders a header back control when provided. */
  onBack?: () => void
  /**
   * Return-to-list handler used on an in-flight terminal (doc deleted / access revoked, 4403).
   * Always wired by DocsHome (= backToList, which also clears the persisted target). Distinct
   * from `onBack`: `onExit` fires programmatically, `onBack` is the (optional) header button.
   */
  onExit?: () => void
  /** Called after a successful rename so the list can refresh its titles. */
  onTitleSaved?: (docId: string, title: string) => void
  /**
   * Called after a successful delete (Problem 4) so the list refreshes and the open doc returns
   * to the empty/list state. Wired by DocsHome to onDocDeleted; when absent, the shell falls back
   * to its own return-to-list handler (onExit ?? onBack).
   */
  onDeleted?: (docId: string) => void
  /**
   * Extra controls injected into the header's right-hand cluster (e.g. the standalone deep-link
   * page's "Copy link"). Optional: when omitted, the in-shell header renders
   * exactly as before — no wrapper, no empty node — so the in-shell path is byte-for-byte
   * unchanged (AC-8 non-regression). Rendered ahead of the built-in comments/members/… cluster.
   */
  headerRight?: ReactNode
  /**
   * "Open in new page" handler (in-shell only). When provided, the header's ≡ "more" menu shows an
   * "Open in new page" row that opens the shareable standalone `/d/:docId` link — the same action
   * the old resident purple button performed. Omitted on the standalone page itself (there is no
   * "open in a new page" from a page that already IS the standalone view), so the row simply
   * doesn't render there.
   */
  onOpenInNewPage?: () => void
  /**
   * Extra rows prepended to the TOP of the header's ≡ "more" menu (in the given order), before the
   * built-in open-in-new-page / history / export rows. Opt-in: when omitted the menu renders exactly
   * as before, so the in-shell path is unchanged (AC-4 non-regression). The standalone page uses this
   * to pin its "Copy link" action as the first menu item, having dropped its resident header button.
   */
  moreMenuLeadItems?: DocMoreMenuItem[]
  /**
   * When true, resolve the creator display name from the NICKNAME only, never the verified
   * `real_name`. Opt-in: defaults to false so the in-shell editor keeps preferring the real name
   * (AC non-regression). The standalone `/d/:docId` page sets this because it is an externally
   * shareable surface — showing the creator's legal name to any link holder is a privacy leak
   * (boss decision).
   */
  creatorNicknameOnly?: boolean
}

/**
 * Base file name (no extension) for the Markdown export: the current document title, trimmed,
 * falling back to the localized "untitled" placeholder and finally a generic "document" so the
 * download always has a sensible name.
 */
export function exportDownloadName(title: string | null | undefined): string {
  return (title || t('docs.state.untitled')).trim() || 'document'
}

/**
 * Editable document title (BUG3). Renders the real document title (fetched via getDoc,
 * falling back to the passed-in title) instead of a hardcoded placeholder. For manage-role
 * users it is click-to-edit: Enter / blur commits via PATCH /docs/{docId}; Esc cancels.
 * Read-only users see a plain heading.
 */
function DocTitle({
  docId,
  initialTitle,
  canEdit,
  onSaved,
  onTitleLoaded,
}: {
  docId: string
  initialTitle: string
  canEdit: boolean
  onSaved?: (docId: string, title: string) => void
  /** Surfaces the real title fetched on mount so the parent can lift it (e.g. the export filename). */
  onTitleLoaded?: (title: string) => void
}) {
  const placeholder = t('docs.state.untitled')
  const [title, setTitle] = useState(initialTitle)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(initialTitle)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // True while a commit is in flight; prevents the Enter-then-blur double commit and
  // any concurrent re-entry. Always reset in finally so it can never get stuck.
  const committingRef = useRef(false)
  // Set true when an edit session ends so the trailing blur (after a programmatic commit
  // or cancel) does not re-commit. Reset when a new edit session starts.
  const doneRef = useRef(false)

  // Fetch the real title once on mount (resilient: keep the fallback prop on failure). Surface the
  // fetched title to the parent so the live (current) title — not the initial prop — drives things
  // like the export filename.
  useEffect(() => {
    let cancelled = false
    getDoc(docId)
      .then((meta) => {
        if (!cancelled && typeof meta?.title === 'string') {
          setTitle(meta.title)
          onTitleLoaded?.(meta.title)
        }
      })
      .catch(() => {
        /* keep the passed-in fallback title */
      })
    return () => {
      cancelled = true
    }
  }, [docId])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const startEdit = useCallback(() => {
    if (!canEdit) return
    doneRef.current = false
    setDraft(title)
    setEditing(true)
  }, [canEdit, title])

  const commit = useCallback(async () => {
    // Read the freshest value straight from the DOM input to avoid any stale-closure
    // draft; fall back to state draft if the input is already gone.
    const raw = inputRef.current?.value ?? draft
    const next = raw.trim()
    // Re-entrancy / double-commit (Enter then blur) guard.
    if (committingRef.current || doneRef.current) return
    // No-op (empty or unchanged): just leave edit mode, no PATCH.
    if (!next || next === title) {
      doneRef.current = true
      setDraft(title)
      setEditing(false)
      return
    }
    committingRef.current = true
    setSaving(true)
    try {
      await updateDocTitle(docId, next)
      doneRef.current = true
      setTitle(next)
      setDraft(next)
      onSaved?.(docId, next)
      setEditing(false) // only leave edit mode AFTER a successful PATCH
    } catch {
      // Keep the input open with the user's draft so the edit isn't silently lost.
      setEditing(true)
      setTimeout(() => inputRef.current?.focus(), 0)
    } finally {
      setSaving(false)
      committingRef.current = false
    }
  }, [draft, title, docId, onSaved])

  const cancel = useCallback(() => {
    doneRef.current = true // suppress the blur-commit that follows programmatic blur
    setDraft(title)
    setEditing(false)
  }, [title])

  const hasTitle = !!title && title.trim().length > 0
  const display = hasTitle ? title : placeholder

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="octo-doc-title octo-doc-title-input"
        value={draft}
        disabled={saving}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          void commit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void commit() // commit directly; doneRef stops the trailing blur re-commit
          } else if (e.key === 'Escape') {
            e.preventDefault()
            cancel()
          }
        }}
      />
    )
  }

  return (
    <h1
      className={
        canEdit
          ? 'octo-doc-title octo-doc-title-editable'
          : 'octo-doc-title'
      }
      title={canEdit ? t('docs.title.editHint') : undefined}
      onClick={startEdit}
      role={canEdit ? 'button' : undefined}
      tabIndex={canEdit ? 0 : undefined}
      onKeyDown={
        canEdit
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                startEdit()
              }
            }
          : undefined
      }
    >
      {display}
    </h1>
  )
}

/** Page shell (frontend-design §3.1): title / toolbar / content / presence + right-side drawer. */
export function EditorShell(props: EditorShellProps) {
  const { title, onBack, onExit, onTitleSaved, onDeleted, headerRight, onOpenInNewPage, moreMenuLeadItems, creatorNicknameOnly, ...collabOpts } =
    props
  const docId = props.docId
  const { instance, ready, role, connState, terminal } = useCollabEditor(collabOpts)
  // The live document title, lifted out of DocTitle so the export filename uses the current
  // (fetched / edited) title rather than the initial `title` prop. Seeded from the prop, then
  // updated when DocTitle fetches the real title on mount and when the user renames the doc.
  const [currentTitle, setCurrentTitle] = useState(title)
  // #4/#5: a single mutually-exclusive drawer panel (history | comments | members | null),
  // replacing the three independent show* booleans.
  const [activePanel, setActivePanel] = useState<DrawerPanel>(null)
  const [activeCommentId, setActiveCommentId] = useState<number | null>(null)
  // #A1: the document owner's uid, fetched from doc meta, so the member panel can mark the owner
  // row with an "Owner" badge even on a brand-new single-member (self-owned) document. Without
  // this the panel falls back to a role heuristic that never matches a fresh doc, so the badge
  // never shows. Resilient: stays null if the meta lacks ownerId.
  const [ownerId, setOwnerId] = useState<string | undefined>(undefined)
  // Creation timestamp (RFC3339) for the "more" menu head's "Created on" line. Fetched from the
  // same per-doc GET as ownerId; stays undefined (row hidden) when the backend omits it.
  const [createdAt, setCreatedAt] = useState<string | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    getDoc(docId)
      .then((meta) => {
        if (cancelled) return
        if (typeof meta?.ownerId === 'string' && meta.ownerId) setOwnerId(meta.ownerId)
        if (typeof meta?.createdAt === 'string' && meta.createdAt) setCreatedAt(meta.createdAt)
      })
      .catch(() => {
        /* non-fatal: owner badge + created-on row just won't show */
      })
    return () => {
      cancelled = true
    }
  }, [docId])

  // uid → display name for this space (#8): once resolved, push the real name into awareness so
  // the presence avatar initial and the collaboration caret label show the name, not the uid.
  // The editor is created with the best-known name; this updates it when the member list lands.
  const names = useMemberNames(props.space)

  // Creator display name for the "more" menu head. The doc's ownerId (boss-decided creator
  // semantics) is resolved to a human name: first from the already-loaded space-member map (free,
  // same source the presence caret + member panel use), then — for an owner who isn't in that map
  // — via GET /users/:uid. Resilient: any failure leaves it undefined and the menu falls back to a
  // short uid, so the header can never crash on a missing/failed name lookup.
  const [creatorName, setCreatorName] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!ownerId) return
    // In-shell (creatorNicknameOnly unset): prefer the already-loaded space-member map — free, and
    // the same source the presence caret + member panel use.
    //
    // On the standalone (externally shared) surface (creatorNicknameOnly), SKIP the member-map
    // primary source entirely (XIN-392 P2-1). Gating only the getUserName fallback on
    // creatorNicknameOnly (as before) left the member map as an ungated primary source that leaks a
    // real name the moment the backend fills member display names with verified names — the
    // no-leak-today guarantee rests on the implicit "member name is never a real name" contract.
    // A link holder must never see the creator's verified name, so resolve nickname-only regardless
    // of what the member map holds.
    if (!creatorNicknameOnly) {
      const fromMembers = names.get(ownerId)
      if (fromMembers && fromMembers !== ownerId) {
        setCreatorName(fromMembers)
        return
      }
    }
    let cancelled = false
    // In-shell resolves the verified real name (falling back to nickname); the standalone surface
    // forces nickname-only and never requests real_name.
    getUserName(ownerId, { preferRealName: !creatorNicknameOnly })
      .then((name) => {
        if (!cancelled && name) setCreatorName(name)
      })
      .catch(() => {
        /* keep the uid fallback */
      })
    return () => {
      cancelled = true
    }
  }, [ownerId, names, creatorNicknameOnly])

  // Screen 4c (feature #511): pending access-request count for the Members-button red dot (admin
  // only). Called unconditionally (hooks rules); the hook stays inert when not admin.
  const pendingAccess = useAccessRequests(docId, role ? canManage(role) : false)

  // C4 (#5): reset the drawer whenever the document changes. The shell is keyed by docId in
  // DocsHome (so it already remounts), but this makes the reset explicit and robust if the key
  // strategy ever changes — open history on doc A, switch to doc B → drawer is closed, no stale A.
  useEffect(() => {
    setActivePanel(null)
    setActiveCommentId(null)
  }, [docId])

  // Push the resolved display name into the local awareness `user` field. Resilient: falls back
  // to the uid; never throws if the provider lacks the setter. Keeps the same id/color so the
  // presence dedupe + count (keyed by id) are unaffected — only the displayed name changes.
  useEffect(() => {
    const provider = instance?.provider as
      | { setAwarenessField?: (key: string, value: unknown) => void }
      | undefined
    if (!provider?.setAwarenessField) return
    const uid = props.uid
    const name = names.get(uid) || uid
    provider.setAwarenessField('user', { id: uid, name, color: colorFromId(uid) })
  }, [instance, names, props.uid])

  // Comment state is owned here (single source of truth) so the highlight layer and the panel
  // share it; highlights paint regardless of whether the panel is open.
  const comments = useDocComments(docId)
  useCommentHighlights(instance?.editor ?? null, comments.threads)

  // A click on a comment highlight (decoration layer) opens the comments drawer on that thread.
  useEffect(() => {
    const editor = instance?.editor
    if (!editor) return
    editor.storage.octoCommentHighlight.onActivate = (id: number) => {
      setActivePanel('comments')
      setActiveCommentId(id)
    }
    return () => {
      if (editor.storage.octoCommentHighlight) editor.storage.octoCommentHighlight.onActivate = null
    }
  }, [instance])

  // In-flight deletion / access revocation (4403): show "Document deleted" briefly, then return
  // to the list (onExit = backToList, which also clears the persisted target). onBack is the
  // fallback if onExit wasn't wired.
  const returnToList = onExit ?? onBack
  useEffect(() => {
    if (terminal.kind !== 'deleted' || !returnToList) return
    const id = setTimeout(returnToList, 1200)
    return () => clearTimeout(id)
  }, [terminal.kind, returnToList])

  // Delete entry (Problem 4): on success return to the list. Prefer the parent's onDeleted (it
  // also refreshes the resident list); fall back to the shell's own return-to-list handler.
  const handleDeleted = useCallback(
    (id: string) => {
      if (onDeleted) onDeleted(id)
      else returnToList?.()
    },
    [onDeleted, returnToList],
  )
  const del = useDocDelete(docId, handleDeleted)

  // Export-as-Markdown (batch 8, area C): serialize the live PM JSON to Markdown with freshly
  // resolved signed asset URLs and trigger a browser download. Display-only — never mutates
  // the doc; failures surface a small banner instead of crashing the editor.
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const onExportMarkdown = useCallback(async () => {
    const ed = instance?.editor
    if (!ed || exporting) return
    setExporting(true)
    setExportError(null)
    try {
      const md = await exportDocToMarkdown(docId, ed.getJSON() as unknown as MdNode, { emojiGlyph })
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${exportDownloadName(currentTitle)}.md`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setExportError(t('docs.toolbar.exportError'))
    } finally {
      setExporting(false)
    }
  }, [instance, docId, currentTitle, exporting])

  const togglePanel = useCallback(
    (panel: Exclude<DrawerPanel, null>) => setActivePanel((cur) => (cur === panel ? null : panel)),
    [],
  )
  const closePanel = useCallback(() => setActivePanel(null), [])

  // "Forward to chat" (feature #511): reader+ entry. Recompute grant capability from the LIVE role
  // at click time (E-16: a demoted admin loses授权); the bridge opens the host conversation-select.
  const onForwardToChat = useCallback(() => {
    if (!role) return
    startDocForward({
      docId,
      title: currentTitle,
      role,
      currentUid: getCurrentUid(),
      ownerId,
      space: props.space,
      folder: props.folder,
    })
  }, [docId, currentTitle, role, ownerId, props.space, props.folder])

  if (terminal.kind !== 'none') {
    // Screen 4c (feature #511): the forbidden landing renders inline so it can offer "Request
    // access"; every other terminal kind uses the upstream shared <DocTerminal>.
    if (terminal.kind === 'forbidden') {
      return (
        <div className="octo-doc octo-terminal">
          {onBack && (
            <button type="button" className="octo-doc-back" onClick={onBack}>
              ← {t('docs.list.back')}
            </button>
          )}
          <h2>{title}</h2>
          <p className="octo-terminal-msg">{t('docs.error.permission.forbidden')}</p>
          <RequestAccessButton docId={docId} />
        </div>
      )
    }
    return <DocTerminal title={title} kind={terminal.kind} onBack={onBack} />
  }

  if (!instance) {
    return (
      <div className="octo-doc">
        <p className="octo-loading">{t('docs.state.loading')}</p>
      </div>
    )
  }

  const editor = instance.editor
  const manage = role ? canManage(role) : false
  // "Forward to chat" is only offered when the host actually exposes the conversation-select
  // surface openDocForward() lands on. On the standalone /d/:docId page WKBase isn't mounted (the
  // Layout early-return skips it), so showConversationSelect is undefined and a click would be a
  // silent no-op — hide the entry there rather than render a dead button. In-shell WKBase is always
  // present, so the button shows exactly as before (non-regression).
  const canForward = canForwardToChat()

  // "More" (≡) menu contents. Order is fixed per spec: [caller-provided lead rows] → open-in-new-
  // page → version history → export, with delete pinned last (below a separator) as the destructive
  // row. Lead rows come from the host (e.g. the standalone page's "Copy link"); they sit at the very
  // top so a standalone page — which never wires open-in-new-page — shows Copy link as the first row.
  // The open-in-new-page row only appears when the host wired the handler (in-shell path), never on
  // the standalone page itself.
  const moreItems: DocMoreMenuItem[] = []
  if (moreMenuLeadItems?.length) moreItems.push(...moreMenuLeadItems)
  if (onOpenInNewPage) {
    moreItems.push({
      key: 'open-new-page',
      label: t('docs.standalone.openInNewPage'),
      icon: OpenNewPageIcon,
      onClick: onOpenInNewPage,
    })
  }
  moreItems.push(
    {
      key: 'history',
      label: t('docs.toolbar.history'),
      icon: HistoryIcon,
      onClick: () => togglePanel('history'),
    },
    {
      key: 'export',
      label: t('docs.toolbar.exportMarkdown'),
      icon: ExportIcon,
      disabled: exporting,
      onClick: () => void onExportMarkdown(),
    },
  )
  const deleteItem: DocMoreMenuItem | undefined = manage
    ? {
        key: 'delete',
        label: t('docs.doc.deleteEntry'),
        icon: DeleteIcon,
        danger: true,
        onClick: del.requestDelete,
      }
    : undefined
  // Creator name with fallback: resolved name → short uid → placeholder. Never blank, never crashes.
  const creatorDisplay =
    creatorName || (ownerId ? ownerId.slice(0, 8) : t('docs.moreMenu.unknownCreator'))

  return (
    <div className="octo-doc octo-doc--editor octo-theme">
      <header className="octo-doc-header">
        {onBack && (
          <button
            type="button"
            className="octo-doc-back"
            title={t('docs.list.back')}
            onClick={onBack}
          >
            ← {t('docs.list.back')}
          </button>
        )}
        <DocTitle
          docId={docId}
          initialTitle={title}
          canEdit={manage}
          onSaved={(id, t) => {
            setCurrentTitle(t)
            onTitleSaved?.(id, t)
          }}
          onTitleLoaded={setCurrentTitle}
        />
        <div className="octo-doc-header-right">
          {headerRight}
          <PresenceBar provider={instance.provider} connState={connState} synced={ready} />
          {/* Comments are reader+ (everyone with access — "can see → can comment"). */}
          <button
            type="button"
            className={activePanel === 'comments' ? 'octo-tb-btn is-active' : 'octo-tb-btn'}
            title={t('docs.toolbar.comments')}
            aria-pressed={activePanel === 'comments'}
            onClick={() => togglePanel('comments')}
          >
            💬 {t('docs.toolbar.comments')}
          </button>
          {/* Forward to chat (feature #511) — reader+ (anyone with access can forward the link;
              only admin/owner sees the enabled 授权区, gated inside the modal by canGrant). Gated
              on canForward so it never renders as a silent no-op where the host lacks the
              conversation-select surface (the standalone /d/:docId page). */}
          {role && canForward && (
            <button
              type="button"
              className="octo-tb-btn octo-doc-forward-btn"
              title={t('docs.forward.entry')}
              onClick={onForwardToChat}
            >
              ⤴ {t('docs.forward.entry')}
            </button>
          )}
          {manage && (
            <button
              type="button"
              className={activePanel === 'members' ? 'octo-tb-btn is-active' : 'octo-tb-btn'}
              aria-pressed={activePanel === 'members'}
              onClick={() => togglePanel('members')}
            >
              {t('docs.toolbar.members')}
              {pendingAccess.count > 0 && (
                <span className="octo-access-badge" aria-label={t('docs.forward.pendingTitle')}>
                  {pendingAccess.count}
                </span>
              )}
            </button>
          )}
          {/* Low-frequency actions (open in new page / version history / export / delete) collapse
              into a single ≡ "more" menu pinned to the far right, with a creator + created-on head. */}
          <DocMoreMenu
            creatorName={creatorDisplay}
            createdAt={createdAt}
            items={moreItems}
            dangerItem={deleteItem}
          />
        </div>
      </header>

      {/* Delete confirm — a centered modal (shared ConfirmModal), matching the sheet's delete. */}
      <ConfirmModal
        open={del.confirming}
        title={t('docs.doc.deleteConfirmTitle')}
        message={t('docs.doc.deleteConfirm')}
        confirmLabel={t('docs.doc.delete')}
        cancelLabel={t('docs.doc.deleteCancel')}
        danger
        busy={del.deleting}
        onConfirm={() => void del.confirm()}
        onCancel={del.cancel}
      />
      {del.error && (
        <p className="octo-member-error" role="alert">
          {del.error}
        </p>
      )}
      {exportError && (
        <p className="octo-member-error" role="alert">
          {exportError}
        </p>
      )}

      {/* Body: the header above stays fixed; the toolbar + prose + status bar scroll inside
          .octo-doc-scroll, and the right-side drawer is pinned to THIS region — so it starts
          below the header (never covering the header buttons) and never scrolls away. Mirrors
          the sheet's header-then-fixed-region layout. */}
      <div className="octo-doc-body">
        <div className="octo-doc-scroll">
          <Toolbar editor={editor} />

          <div className="octo-editor-region">
            <EditorBubbleMenu editor={editor} />
            <CommentBubble editor={editor} onCreate={comments.createRoot} />
            <Outline editor={editor} />
            <div className="octo-editor-main">
              <EditorContent editor={editor} className="octo-prose" />
            </div>
          </div>

          <StatusBar editor={editor} provider={instance.provider} />
        </div>

        {/* History + Comments live in the right-side drawer; Members opens a dedicated modal (#A4).
            The drawer is pinned to .octo-doc-body (below the header) so it neither covers the
            header buttons nor scrolls with the document. */}
        {(activePanel === 'history' || activePanel === 'comments') && (
          <aside className="octo-doc-drawer" role="complementary">
            {activePanel === 'history' && role && (
              <VersionPanel docId={docId} role={role} editor={editor} names={names} onClose={closePanel} />
            )}
            {activePanel === 'comments' && role && (
              <CommentPanel
                role={role}
                editor={editor}
                comments={comments}
                activeCommentId={activeCommentId}
                onSelectComment={setActiveCommentId}
                names={names}
                onClose={closePanel}
              />
            )}
          </aside>
        )}
      </div>

      {/* #A4: "Manage members" opens a dedicated modal dialog (overlay), not an inline drawer. */}
      {activePanel === 'members' && manage && (
        <div className="octo-modal-overlay" role="presentation" onMouseDown={closePanel}>
          <div
            className="octo-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t('docs.member.manage')}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <MemberPanel
              docId={docId}
              role={role!}
              space={props.space}
              ownerId={ownerId}
              accessRequests={pendingAccess}
              onClose={closePanel}
            />
          </div>
        </div>
      )}
    </div>
  )
}
