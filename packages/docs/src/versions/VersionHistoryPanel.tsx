// Unified version-history shell (XIN-836 交付物① / 拆单阶段 1).
//
// This is the single container that the doc, sheet and board version panels will each become a
// thin adapter over. It owns everything that is identical across the three ends — list + filter
// tabs + counts + pagination, save / rename / delete / restore, the restore confirm box, the
// unified race guard, and the centered preview / diff modal (Esc / overlay-close / focus) — and
// leaves each end to inject ONLY what is genuinely end-specific: how to load one version's state,
// how to render its preview, how to render its diff, and what "current" is.
//
// It changes NOTHING for users yet: this phase adds the shell and its guard util + tests, and does
// not wire any end to it (the doc/sheet/board panels are untouched, so there is zero visible
// change until an adapter phase switches an end over).
//
// Reuse contract (unchanged by design): list / create / rename / delete / restore all go through
// the shared REST layer in ./api.ts — the shell adds NO new endpoint. Preview alone is pluggable
// because each end decodes a different payload (PM-JSON doc / sheet cells / board scene).
//
// i18n: this shell reuses the existing `docs.version.*` message keys. A handful of new keys it
// references — filterAll / filterManual / filterAuto, countManual / countAuto, and staleNotice —
// are intentionally NOT added in this phase: the acceptance gate keeps this phase's diff to new
// files + tests only, and the shell is not mounted anywhere yet, so no user ever sees a raw key.
// Those keys land in the doc-adapter phase, when an end first renders the shell.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Role } from '../auth/roles.ts'
import { canSnapshot, canRestoreVersion } from '../auth/roles.ts'
import { t } from '../octoweb/index.ts'
import { formatRelative, formatAbsolute, autosaveLabel } from './format.ts'
import {
  listVersions,
  createNamedVersion,
  restoreVersion,
  renameVersion,
  deleteVersion,
  VersionSchemaIncompatibleError,
  VersionSchemaNewerError,
  type VersionMeta,
  type VersionCounts,
} from './api.ts'
import { createRaceGuard } from './raceGuard.ts'
import { isBotEditVersion } from './botEdit.ts'
import { ContextMenu, useContextMenu } from '../ui/ContextMenu.tsx'
import { pickBotEditVersion, type BotDiffHint } from './botEditForThread.ts'

export type KindFilter = 'all' | 'manual' | 'auto'

/** Default page size when a host does not override it (doc 25 / board 30 / sheet 50 → unify at 30). */
const DEFAULT_PAGE_SIZE = 30

/**
 * Handlers the shell hands to `renderBotDiff` so the injected view can drive the shell:
 *   close    — dismiss the bot-diff modal (the view's own Close button / a successful dismiss).
 *   restored — the view undid the bot's edit through the shared restore endpoint, so the history
 *              gained rows; the shell soft-refreshes the list (and forwards to `onRestored`).
 */
export interface BotDiffHost {
  close: () => void
  restored: () => void
}

export interface VersionHistoryPanelProps<TState, TCurrent> {
  docId: string
  role: Role
  /** uid → display-name map so a row's author shows a name, not a raw uid. */
  names?: Map<string, string>
  onClose?: () => void

  // —— list data source (always the shared listVersions; knobs only) ——
  pageSize?: number
  defaultFilter?: KindFilter

  // —— change hooks (all mutations reuse ./api.ts; these only tune error text / post-effects) ——
  /** Called after a successful restore (board refreshes chrome; doc/sheet may omit). */
  onRestored?: () => void
  /** Map a preview error to an i18n key (board passes versionErrorKey; default handles schema/network). */
  previewErrorKey?: (e: unknown) => string
  /** Map a restore error to an i18n key (same default; board passes its richer classifier). */
  restoreErrorKey?: (e: unknown) => string

  // —— preview / diff (the pluggable core) ——
  /** Load one version's decoded state for preview/diff. MUST honor the AbortSignal. */
  loadPreviewState: (seq: number, signal: AbortSignal) => Promise<TState>
  /** Render the read-only preview of a loaded state (throwaway editor / grid / scene). */
  renderPreview: (state: TState) => ReactNode
  /** Render the diff of a version against current. Omit → the modal hides the "compare" entry. */
  renderDiff?: (state: TState, current: TCurrent | null) => ReactNode
  /** The "current" side of a diff (live editor JSON / sheet cells). Omit when there is no diff. */
  getCurrent?: () => TCurrent | null

  /**
   * OPTIONAL bot-edit diff renderer. When supplied, every row identified as a bot content edit's
   * pre-edit safety snapshot (see ./botEdit.ts) grows a "view what the bot changed" button that
   * opens this node in the shell's centered modal. Omit → bot rows still get their badge/label (the
   * "a bot changed this" signal is worth having on its own) but no diff entry point is rendered.
   */
  renderBotDiff?: (v: VersionMeta, host: BotDiffHost) => ReactNode
  /**
   * 从评论区的任务卡片跳过来时带的定位信息:被 @ 的 Bot + 「根评论 → Bot 回复」的时间窗。
   * 列表到位后用它挑出对应的安全快照并**直接打开** Diff。
   *
   * 唯一命中才自动打开(pickBotEditVersion 内部判定);命中 0 个或多个时什么都不做,用户就停在
   * 版本列表上自己看 —— 猜错会把别人的改动展示成这条评论的结果。 */
  botDiffHint?: BotDiffHint | null
}

/** Preview modal state machine — end-agnostic (the payload itself is TState, held separately). */
type PreviewState = 'idle' | 'loading' | 'ready' | 'error'

/** Default error → i18n key mapping when a host does not inject its own classifier. */
function defaultErrorKey(e: unknown): string {
  if (e instanceof VersionSchemaNewerError) return 'docs.version.previewSchemaNewer'
  if (e instanceof VersionSchemaIncompatibleError) return 'docs.version.previewSchemaIncompatible'
  return 'docs.version.previewNetworkError'
}

function kindBadge(v: VersionMeta): string {
  // A bot content edit's safety snapshot is a restore-marker on the wire, but "已恢复/restored" is
  // the wrong story for it — it is "a bot changed the document here". Checked first for that reason.
  if (isBotEditVersion(v)) return t('docs.version.badgeBotEdit')
  if (v.kind === 'named') return t('docs.version.badgeNamed')
  if (v.kind === 'restore-marker') {
    return v.restoredFrom != null
      ? t('docs.version.badgeRestoredFrom', { values: { from: v.restoredFrom } })
      : t('docs.version.badgeRestored')
  }
  return t('docs.version.badgeAuto')
}

/**
 * Row title. `botName` is the resolved display name of `createdBy` (the actor) and is only used for
 * bot-edit rows, whose raw `label` is an internal ENGLISH string ('Auto-safety before bot edit')
 * that must never reach a user — so it is replaced with localized copy that also states the
 * snapshot's real semantics: this is the state BEFORE the edit, not the edit's result.
 */
/** 原型「⇅ 查看 Diff」里那个上下箭头。内联 SVG,不为一个图标引依赖。 */
function DiffGlyph() {
  return (
    <svg className="octo-diff-glyph" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M3.5 1.5v9M3.5 1.5 1.5 3.5M3.5 1.5 5.5 3.5M8.5 10.5v-9M8.5 10.5 6.5 8.5M8.5 10.5l2-2"
        fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function displayLabel(v: VersionMeta, botName?: string): string {
  if (isBotEditVersion(v)) {
    return botName
      ? t('docs.version.botEditLabel', { values: { name: botName } })
      : t('docs.version.botEditLabelGeneric')
  }
  if (v.label && v.label.trim() !== '') return v.label
  if (v.kind === 'restore-marker') {
    return v.restoredFrom != null
      ? t('docs.version.labelRestoredFrom', { values: { from: v.restoredFrom } })
      : t('docs.version.labelRestored')
  }
  return autosaveLabel(v.createdAt)
}

/**
 * 行内第二行的说明，原型形态：
 *   Bot 版本 → `张三通过 @ProductAgent 发起当前选区修改；Bot 完成写入后临时权限即刻失效。`
 *   人类版本 → `自动保存的文档版本`
 *
 * 为什么值得单独一行：Bot 改过正文这件事，用户最想确认的是「它还能不能再改」。原型用这句话
 * 明确「临时权限即刻失效」，把一次性授权说清楚 —— 光有个「BOT 修改」徽章传达不了这层。
 * 拿不到发起人名字时退化成不点名的说法，绝不把裸 uid 拼进文案。
 */
function rowDescription(v: VersionMeta, actorName?: string, botName?: string): string {
  if (isBotEditVersion(v)) {
    if (actorName && botName) {
      return t('docs.version.botEditDesc', { values: { actor: actorName, bot: botName } })
    }
    return t('docs.version.botEditDescGeneric')
  }
  if (v.kind === 'named') return t('docs.version.namedDesc')
  if (v.kind === 'restore-marker') return t('docs.version.restoreDesc')
  return t('docs.version.autoDesc')
}

export function VersionHistoryPanel<TState, TCurrent>({
  docId,
  role,
  names,
  onClose,
  pageSize = DEFAULT_PAGE_SIZE,
  defaultFilter = 'all',
  onRestored,
  previewErrorKey,
  restoreErrorKey,
  loadPreviewState,
  renderPreview,
  renderDiff,
  getCurrent,
  renderBotDiff,
  botDiffHint,
}: VersionHistoryPanelProps<TState, TCurrent>) {
  const [items, setItems] = useState<VersionMeta[]>([])
  const [counts, setCounts] = useState<VersionCounts | null>(null)
  const [nextCursor, setNextCursor] = useState<number | null>(null)
  const [filter, setFilter] = useState<KindFilter>(defaultFilter)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Inline "save current version" compose row (no native prompt — unified across ends).
  const [snapshotOpen, setSnapshotOpen] = useState(false)
  const [snapshotLabel, setSnapshotLabel] = useState('')

  // Inline rename compose row (replaces the sheet panel's native window.prompt).
  const [renamingSeq, setRenamingSeq] = useState<number | null>(null)
  const [renameLabel, setRenameLabel] = useState('')

  // Restore is confirmed in a centered in-panel box (doc model), not a native window.confirm.
  const [confirmRestore, setConfirmRestore] = useState<VersionMeta | null>(null)
  // Delete is likewise confirmed in the same in-panel box (was a native window.confirm) so the
  // destructive-action UX is unified across doc/sheet/board rather than falling back to the browser.
  const [confirmDelete, setConfirmDelete] = useState<VersionMeta | null>(null)

  // Centered preview / diff modal.
  const [selected, setSelected] = useState<VersionMeta | null>(null)
  const [previewData, setPreviewData] = useState<TState | null>(null)
  const [previewState, setPreviewState] = useState<PreviewState>('idle')
  const [previewErr, setPreviewErr] = useState<string>('docs.version.previewNetworkError')
  const [compare, setCompare] = useState(false)
  // 右键菜单:哪一行 + 在哪弹。放在面板级而不是行级 —— renderRow 在 .map 里被调用多次,
  // 在里面调 useContextMenu 会让 hook 数量随行数变化(违反 hook 规则)。同时也只可能开一个。
  const [rowMenu, setRowMenu] = useState<{ seq: number; x: number; y: number } | null>(null)
  // 自动打开只做一次。不加这个闩,用户手动关掉 Diff 之后下一次列表刷新(轮询/分页)会把它
  // 又弹出来 —— 关不掉的弹窗。
  const consumedHintRef = useRef<BotDiffHint | null>(null)

  // Bot-edit diff modal: the row whose pre-edit snapshot is being diffed against the live body.
  // Independent of `selected` (the preview modal) and mutually exclusive with it — opening one
  // closes the other, so two overlays are never stacked.
  const [botDiffFor, setBotDiffFor] = useState<VersionMeta | null>(null)

  // One guard for the list (refresh = primary, load-more = follow-up) and an independent one for
  // preview — both from the shared createRaceGuard so all three chains abort + last-write-win.
  const listGuard = useRef(createRaceGuard())
  const previewGuard = useRef(createRaceGuard())
  // Liveness flag: mutation handlers setState after an await, and refresh()/the guards only cover
  // their own async chains — this guards the trailing setBusy/setNotice/onRestored in the handlers
  // so they no-op if the panel unmounted mid-flight (no setState-after-unmount).
  const mounted = useRef(true)

  const mySnapshot = canSnapshot(role)
  const myRestore = canRestoreVersion(role)
  const nameOf = (uid: string) => names?.get(uid) || uid
  // Compare is only offered when the host can both diff and supply "current".
  const canCompare = !!(renderDiff && getCurrent)

  // Reload the first page for the current filter. `soft` suppresses the red load error for the
  // post-mutation case (the mutation itself already succeeded; a refresh miss only means the list
  // may be stale). Returns whether the fresh list was applied.
  const refresh = useCallback(
    async (opts?: { soft?: boolean }): Promise<boolean> => {
      const { signal, isCurrent } = listGuard.current.begin()
      setLoading(true)
      setError(null)
      setNotice(null)
      try {
        const res = await listVersions(docId, { kind: filter, limit: pageSize, signal })
        if (!isCurrent()) return false
        setItems(res.items)
        setNextCursor(res.nextCursor)
        setCounts(res.counts ?? null)
        return true
      } catch {
        if (!isCurrent()) return false
        if (!opts?.soft) setError(t('docs.version.errorList'))
        return false
      } finally {
        if (isCurrent()) setLoading(false)
      }
    },
    [docId, filter, pageSize],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Abort any in-flight request when the panel unmounts.
  useEffect(() => {
    mounted.current = true // re-arm on (re)mount so StrictMode's mount→cleanup→remount stays live
    const list = listGuard.current
    const preview = previewGuard.current
    return () => {
      mounted.current = false
      list.abort()
      preview.abort()
    }
  }, [])

  const onLoadMore = async () => {
    if (loadingMore || nextCursor == null) return
    const { signal, isCurrent } = listGuard.current.beginFollowUp()
    setLoadingMore(true)
    setError(null)
    try {
      const res = await listVersions(docId, { kind: filter, cursor: nextCursor, limit: pageSize, signal })
      // Bound to the list guard: if a refresh / filter switch / restore (begin) OR a newer
      // load-more (beginFollowUp) superseded this page before it landed, isCurrent() is false and
      // we drop it — never appending stale/duplicate rows onto a list that moved on. The follow-up
      // token in createRaceGuard is what makes the "newer load-more" case report non-current even
      // though the aborted request may have resolved a hair before its abort.
      if (!isCurrent()) return
      setItems((cur) => [...cur, ...res.items])
      setNextCursor(res.nextCursor)
      if (res.counts) setCounts(res.counts)
    } catch {
      if (!isCurrent()) return
      setError(t('docs.version.errorMore'))
    } finally {
      // Always clear the loading flag on this follow-up's own completion, independent of
      // isCurrent(). The guard's job is to discard the stale *result* (handled by the early
      // returns above); the *loading flag* must not be gated on isCurrent(), or a superseded
      // load-more (filter switch / refresh / restore while a page is in flight) would skip this
      // reset and wedge loadingMore=true forever, permanently disabling the Load More button.
      // A superseded-but-mounted setState is harmless; a genuine unmount is covered by the guard
      // util's abort; a newer load-more re-sets the flag true itself.
      setLoadingMore(false)
    }
  }

  const selectFilter = (k: KindFilter) => {
    if (k === filter) return
    // Switching filter reloads the list; drop the open preview (it belongs to the previous set).
    closePreview()
    setBotDiffFor(null)
    setFilter(k)
  }

  const onCreateSnapshot = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await createNamedVersion(docId, snapshotLabel.trim() || undefined)
    } catch {
      if (!mounted.current) return
      setError(t('docs.version.errorSave'))
      setBusy(false)
      return
    }
    if (!mounted.current) return
    setSnapshotOpen(false)
    setSnapshotLabel('')
    const ok = await refresh({ soft: true })
    if (!mounted.current) return
    if (!ok) setNotice(t('docs.version.staleNotice'))
    setBusy(false)
  }

  const beginRename = (seq: number, cur: string) => {
    setRenamingSeq(seq)
    setRenameLabel(cur)
  }

  const cancelRename = () => {
    setRenamingSeq(null)
    setRenameLabel('')
  }

  const commitRename = async (seq: number) => {
    const label = renameLabel.trim()
    if (label === '') return
    setBusy(true)
    setError(null)
    try {
      await renameVersion(docId, seq, label)
    } catch {
      if (!mounted.current) return
      setError(t('docs.version.errorRename'))
      setBusy(false)
      return
    }
    if (!mounted.current) return
    // Optimistic label update, then reconcile with server ordering/counts (soft: rename landed).
    setItems((cur) => cur.map((v) => (v.docVersionSeq === seq ? { ...v, label } : v)))
    cancelRename()
    const ok = await refresh({ soft: true })
    if (!mounted.current) return
    if (!ok) setNotice(t('docs.version.staleNotice'))
    setBusy(false)
  }

  const onDelete = async (v: VersionMeta) => {
    setBusy(true)
    setError(null)
    try {
      await deleteVersion(docId, v.docVersionSeq)
    } catch {
      if (!mounted.current) return
      setError(t('docs.version.errorDelete'))
      setConfirmDelete(null)
      setBusy(false)
      return
    }
    if (!mounted.current) return
    setConfirmDelete(null)
    if (selected?.docVersionSeq === v.docVersionSeq) closePreview()
    if (botDiffFor?.docVersionSeq === v.docVersionSeq) setBotDiffFor(null)
    if (renamingSeq === v.docVersionSeq) cancelRename()
    setItems((cur) => cur.filter((x) => x.docVersionSeq !== v.docVersionSeq))
    const ok = await refresh({ soft: true })
    if (!mounted.current) return
    if (!ok) setNotice(t('docs.version.staleNotice'))
    setBusy(false)
  }

  const onConfirmRestore = async (v: VersionMeta) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    let res: { newDocVersionSeq: number; restoredFrom: number }
    try {
      res = await restoreVersion(docId, v.docVersionSeq)
    } catch (e) {
      if (!mounted.current) return
      setError(t(restoreErrorKey ? restoreErrorKey(e) : 'docs.version.errorRestore'))
      setConfirmRestore(null)
      setBusy(false)
      return
    }
    if (!mounted.current) return
    // Restore landed — the live surface reconciles via Yjs. A follow-up refresh miss is soft.
    setConfirmRestore(null)
    closePreview()
    const ok = await refresh({ soft: true })
    if (!mounted.current) return
    setNotice(
      ok
        ? t('docs.version.restoredNotice', { values: { from: res.restoredFrom, seq: res.newDocVersionSeq } })
        : t('docs.version.staleNotice'),
    )
    onRestored?.()
    setBusy(false)
  }

  // startInCompare:Bot 行的「查看 Diff」直接进对比模式。Bot 改前的安全快照 vs 当前
  // 正文,就是「Bot 改了什么」—— 语义上和这个对比完全一致,所以复用同一条预览/对比
  // 路径,不另造一套 diff。默认 false:普通行照旧先看快照本身。
  // 带着定位信息进来时,列表一到位就打开对应的 Diff。放在 effect 里而不是渲染中:要等 items
  // 真的加载完(第一帧是空列表,那时挑不出东西)。
  useEffect(() => {
    if (!botDiffHint || consumedHintRef.current === botDiffHint) return
    if (items.length === 0) return
    const target = pickBotEditVersion(items, botDiffHint)
    consumedHintRef.current = botDiffHint
    if (!target) return // 不唯一 —— 停在列表上,不猜
    if (renderBotDiff) setBotDiffFor(target)
    else void onPreviewRef.current(target, true)
  }, [botDiffHint, items, renderBotDiff])

  const onPreview = async (v: VersionMeta, startInCompare = false) => {
    const { signal, isCurrent } = previewGuard.current.begin()
    setSelected(v)
    setCompare(startInCompare)
    setPreviewState('loading')
    setPreviewData(null)
    setError(null)
    setNotice(null)
    try {
      const state = await loadPreviewState(v.docVersionSeq, signal)
      if (!isCurrent()) return // superseded by a newer preview
      setPreviewData(state)
      setPreviewState('ready')
    } catch (e) {
      if (!isCurrent()) return // superseded; swallow the stale error
      setPreviewErr(previewErrorKey ? previewErrorKey(e) : defaultErrorKey(e))
      setPreviewState('error')
    }
  }

  // effect 里要调 onPreview,而它每次渲染都是新函数。走 ref 读最新的那个,免得把它塞进
  // 依赖数组导致 effect 每帧重跑。
  const onPreviewRef = useRef(onPreview)
  onPreviewRef.current = onPreview

  const closePreview = useCallback(() => {
    // Abort an in-flight preview so a late response can't reopen the modal after close.
    previewGuard.current.begin()
    setSelected(null)
    setPreviewData(null)
    setPreviewState('idle')
    setCompare(false)
  }, [])

  const closeBotDiff = useCallback(() => setBotDiffFor(null), [])

  /**
   * The bot-diff view undid the bot's edit through the shared restore endpoint. That is a FORWARD
   * operation (the backend auto-saves current, then reconciles), so the history grew by two rows and
   * the list must be reloaded. The success message itself stays inside the diff view — the user is
   * looking at it, not at the list behind it — so a refresh miss only downgrades to the stale notice.
   */
  const onBotDiffRestored = useCallback(async () => {
    const ok = await refresh({ soft: true })
    if (!mounted.current) return
    if (!ok) setNotice(t('docs.version.staleNotice'))
    onRestored?.()
  }, [refresh, onRestored])

  // Escape closes the bot-edit diff modal, same as the preview modal. Note it also dismisses that
  // view's undo confirm along with the modal — nothing destructive has run at that point.
  useEffect(() => {
    if (!botDiffFor) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeBotDiff()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [botDiffFor, closeBotDiff])

  // Escape closes the preview modal (mirrors the doc panel / manage-members convention).
  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePreview()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selected, closePreview])

  // Escape also cancels the restore / delete confirm overlay, matching the preview modal's Esc/
  // overlay-close behavior. It only clears the confirm state (never the in-flight mutation), and it
  // no-ops while a mutation is running so a keypress can't dismiss the box mid-request.
  useEffect(() => {
    if (!confirmRestore && !confirmDelete) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return
      setConfirmRestore(null)
      setConfirmDelete(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [confirmRestore, confirmDelete, busy])

  const filterBtn = (k: KindFilter, label: string) => (
    <button
      type="button"
      className={filter === k ? 'octo-tb-btn is-active' : 'octo-tb-btn'}
      aria-pressed={filter === k}
      disabled={loading || loadingMore}
      onClick={() => selectFilter(k)}
    >
      {label}
    </button>
  )

  function renderRow(v: VersionMeta) {
    const isSelected = selected?.docVersionSeq === v.docVersionSeq
    const renameable = mySnapshot && v.kind === 'named'
    const isRenaming = renamingSeq === v.docVersionSeq
    const isBotEdit = isBotEditVersion(v)
    // Only pass a name when the roster actually resolved the uid — otherwise the label would read
    // "27eu…_bot 修改前的快照" and leak a raw uid, so the generic wording is used instead.
    const authorName = names?.get(v.createdBy)
    // 「谁发起」= 触发这次 Bot 修改的人。Bot 快照的 createdBy 是 **Bot 自己**(它用临时权限
    // 写的),所以发起人只能从触发它的那条评论的作者拿 —— 而版本记录里没有这个关联。
    // 有 initiatorUid 字段才显示,拿不到就不拼这一段,绝不拿 createdBy 冒充发起人
    // (那会把「Bot 发起」写在标题上,而实际是某个人发起的)。
    const initiatorUid = (v as { initiatorUid?: string }).initiatorUid
    const initiatorName = initiatorUid ? names?.get(initiatorUid) : undefined
    return (
      <li
        key={v.docVersionSeq}
        className={`octo-version-row octo-version-row-${v.kind}${isBotEdit ? ' is-bot-edit' : ''}${isSelected ? ' is-selected' : ''}`}
        tabIndex={0}
        onContextMenu={(e) => {
          e.preventDefault()
          setRowMenu({ seq: v.docVersionSeq, x: e.clientX, y: e.clientY })
        }}
        onKeyDown={(e) => {
          // ContextMenu 键 / Shift+F10:右键菜单的两个标准键位。只做鼠标右键会让恢复和
          // 重命名对键盘用户彻底消失。
          if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return
          e.preventDefault()
          const r = e.currentTarget.getBoundingClientRect()
          setRowMenu({ seq: v.docVersionSeq, x: r.left + 8, y: r.top + 8 })
        }}
      >
        <div className="octo-version-main">
        <div className="octo-version-line1">
          {/* Bot 行不挂色块:原型的标题是一行纯文本(`v130 · Lobster 修改 · 张三发起`),
              「这是 Bot 改的」由标题里的「… 修改」和整行的淡紫底表达,再加一个紫 chip 就是
              同一件事说三遍。非 Bot 行保留原有 badge(命名/恢复标记仍靠它区分)。 */}
          {!isBotEdit && (
            <span className={`octo-version-badge octo-version-badge-${v.kind}`}>{kindBadge(v)}</span>
          )}
          {isRenaming ? (
            <input
              className="octo-uid"
              value={renameLabel}
              placeholder={t('docs.version.labelPlaceholder')}
              onChange={(e) => setRenameLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitRename(v.docVersionSeq)
                else if (e.key === 'Escape') cancelRename()
              }}
              autoFocus
            />
          ) : (
            <>
              {/* 版本号作为独立元素前置，而不是拼进标题字符串 —— 原型的 `v127 · …` 视觉照样达成，
                  但既有测试断言的是精确标题文本（如 `Draft v1`），拼进去会打破主干的显示契约。 */}
              <span className="octo-version-seq">v{v.docVersionSeq}</span>
              <span className="octo-version-sep" aria-hidden="true">·</span>
              <span className="octo-version-label">{displayLabel(v, authorName)}</span>
              {/* 原型的标题第三段是「· 张三发起」—— 谁让 Bot 改的,是这一行最该先看到的
                  归属信息。只有解析出真名才拼,否则会把裸 uid 贴到标题上。 */}
              {isBotEdit && initiatorName && (
                <span className="octo-version-initiator">
                  {t('docs.version.initiatedBy', { values: { name: initiatorName } })}
                </span>
              )}
            </>
          )}
          {/* 时间只出现一次。第二行开头已经是「10 小时前 · 说明…」,原型第一行右侧留给
              操作按钮 —— 之前两处都放,右上角那个还被挤成了「10 小时」(少个「前」)。 */}
          {!isBotEdit && (
            <span className="octo-version-time" title={formatAbsolute(v.createdAt)}>
              {formatRelative(v.createdAt)}
            </span>
          )}
        </div>
        <div className="octo-version-line2">
          {/* 原型第二行是「时间 · 一句话说明」，而不是光一个作者名 —— 说明这一版是怎么来的、
              以及（Bot 版本）临时权限已经失效。作者名已并入上面的标题（`…· 张三发起`）。 */}
          <span className="octo-version-meta">
            {formatRelative(v.createdAt)} · {rowDescription(v, initiatorName, authorName)}
          </span>
        </div>
        </div>
        <div className="octo-version-actions">
          {isRenaming ? (
            <>
              <button
                type="button"
                className="octo-tb-btn"
                disabled={busy || renameLabel.trim() === ''}
                onClick={() => void commitRename(v.docVersionSeq)}
              >
                {t('docs.version.save')}
              </button>
              <button type="button" className="octo-tb-btn" disabled={busy} onClick={cancelRename}>
                {t('docs.version.cancel')}
              </button>
            </>
          ) : (
            <>
              {/* 所有行都以「⇅ 查看 Diff」领头 —— 不管是 Bot 改的还是人存的,「跟现在比差在哪」
                  都是打开这一行最先想问的。Bot 行走 renderBotDiff(宿主提供的专用视图,自带
                  撤销);其余行直接进「该版本 vs 当前」的对比模式,复用同一条预览路径。 */}
              {isBotEdit && renderBotDiff ? (
                <button
                  type="button"
                  className="octo-tb-btn octo-version-bot-diff-btn"
                  onClick={() => {
                    closePreview()
                    setBotDiffFor(v)
                  }}
                >
                  <DiffGlyph />
                  {t('docs.version.viewBotDiff')}
                </button>
              ) : (
                canCompare && (
                  <button
                    type="button"
                    className="octo-tb-btn octo-version-bot-diff-btn"
                    onClick={() => void onPreview(v, true)}
                  >
                    <DiffGlyph />
                    {t('docs.version.viewBotDiff')}
                  </button>
                )
              )}
              {/* canCompare 为假(宿主没给 renderDiff/getCurrent)时退回纯预览,否则这一行
                  会一个操作都没有。 */}
              {!canCompare && !isBotEdit && (
                <button type="button" className="octo-tb-btn" onClick={() => void onPreview(v)}>
                  {t('docs.version.preview')}
                </button>
              )}
              {myRestore && (
                <button
                  type="button"
                  className="octo-tb-btn octo-version-danger-btn"
                  disabled={busy}
                  onClick={() => setConfirmDelete(v)}
                >
                  {t('docs.version.delete')}
                </button>
              )}
            </>
          )}
          {/* 恢复和重命名收进右键。它们没有被删掉 —— 预览弹窗里没有恢复入口,行上也不放的话
              「回到某个旧版本」就彻底没路可走了,那是版本记录存在的理由。跟评论面板同一个
              交互(右键 / ContextMenu 键 / Shift+F10),不是只能鼠标右键。 */}
          {!isRenaming && (
            <ContextMenu
              anchor={rowMenu?.seq === v.docVersionSeq ? { x: rowMenu.x, y: rowMenu.y } : null}
              onClose={() => setRowMenu(null)}
              items={[
                ...(myRestore
                  ? [{ key: 'restore', label: t('docs.version.restore'), onSelect: () => setConfirmRestore(v) }]
                  : []),
                ...(renameable
                  ? [{ key: 'rename', label: t('docs.version.rename'), onSelect: () => beginRename(v.docVersionSeq, v.label) }]
                  : []),
              ]}
            />
          )}
        </div>
      </li>
    )
  }

  const currentForDiff = compare && getCurrent ? getCurrent() : null

  return (
    <>
      <section className="octo-version-panel octo-version-history-panel">
        <div className="octo-member-row">
          <h3 style={{ flex: 1, margin: 0 }}>{t('docs.version.title')}</h3>
          {onClose && (
            <button type="button" className="octo-tb-btn" onClick={onClose}>
              {t('docs.version.close')}
            </button>
          )}
        </div>

        {/* 「全部/手动/自动」筛选与计数是主干功能（PR#656 的统一版本面板，有 8 个测试守着），
            原型里没有它 —— 但删掉等于砍同事的功能，不该由这个分支单方面决定。
            产品负责人的疑问是「为什么 bot 修改会归到手动里」：因为分类按后端 kind 划分，而 Bot
            编辑前的安全快照是 kind=3(restore-marker)，被计入了 `手动` 那一档。真正该修的是这个
            归类，而不是把整个筛选拿掉 —— 已在下面把 Bot 快照单独计数、不再混进「手动」。 */}
        <div className="octo-member-row octo-version-filters">
          {filterBtn('all', t('docs.version.filterAll'))}
          {filterBtn('manual', t('docs.version.filterManual'))}
          {filterBtn('auto', t('docs.version.filterAuto'))}
          {counts && (
            <span className="octo-version-counts" style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.7 }}>
              {t('docs.version.countManual')} {counts.manual + counts.restore} · {t('docs.version.countAuto')} {counts.auto}
            </span>
          )}
        </div>

        {mySnapshot && (
          <div className="octo-version-save">
            {snapshotOpen ? (
              <div className="octo-member-row">
                <input
                  className="octo-uid"
                  placeholder={t('docs.version.labelPlaceholder')}
                  value={snapshotLabel}
                  onChange={(e) => setSnapshotLabel(e.target.value)}
                  autoFocus
                />
                <button type="button" className="octo-tb-btn" disabled={busy} onClick={() => void onCreateSnapshot()}>
                  {t('docs.version.save')}
                </button>
                <button
                  type="button"
                  className="octo-tb-btn"
                  disabled={busy}
                  onClick={() => {
                    setSnapshotOpen(false)
                    setSnapshotLabel('')
                  }}
                >
                  {t('docs.version.cancel')}
                </button>
              </div>
            ) : (
              // 原型里这是列表上方一条占满宽度的深色主按钮，而不是一个混在文字里的小 chip：
              // 「保存当前版本」是这个面板唯一的主动作，视觉权重要压过每行的次级操作。
              <button
                type="button"
                className="octo-tb-btn octo-version-save-primary"
                disabled={busy}
                onClick={() => setSnapshotOpen(true)}
              >
                {t('docs.version.saveCurrent')}
              </button>
            )}
          </div>
        )}

        {notice && <p className="octo-version-notice">{notice}</p>}
        {error && <p className="octo-member-error">{error}</p>}

        {loading && items.length === 0 && <p className="octo-loading">{t('docs.version.loadingList')}</p>}
        {!loading && items.length === 0 && <p className="octo-version-empty">{t('docs.version.empty')}</p>}

        <ul className="octo-version-list">{items.map(renderRow)}</ul>

        {nextCursor != null && (
          <div className="octo-member-row" style={{ justifyContent: 'center' }}>
            <button type="button" className="octo-tb-btn" disabled={loading || loadingMore} onClick={() => void onLoadMore()}>
              {t('docs.version.loadMore')}
            </button>
          </div>
        )}

        {confirmRestore && (
          <div
            className="octo-modal-overlay octo-modal-overlay--center"
            role="presentation"
            onMouseDown={() => {
              if (!busy) setConfirmRestore(null)
            }}
          >
            <div
              className="octo-version-confirm"
              role="dialog"
              aria-modal="true"
              aria-label={t('docs.version.restore')}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <p>{t('docs.version.confirmTitle', { values: { seq: confirmRestore.docVersionSeq } })}</p>
              <p className="octo-version-confirm-detail">{t('docs.version.confirmDetail')}</p>
              <div className="octo-member-row">
                <button
                  type="button"
                  className="octo-tb-btn"
                  disabled={busy}
                  onClick={() => void onConfirmRestore(confirmRestore)}
                >
                  {t('docs.version.restore')}
                </button>
                <button
                  type="button"
                  className="octo-tb-btn"
                  disabled={busy}
                  onClick={() => setConfirmRestore(null)}
                >
                  {t('docs.version.cancel')}
                </button>
              </div>
            </div>
          </div>
        )}

        {confirmDelete && (
          <div
            className="octo-modal-overlay octo-modal-overlay--center"
            role="presentation"
            onMouseDown={() => {
              if (!busy) setConfirmDelete(null)
            }}
          >
            <div
              className="octo-version-confirm"
              role="dialog"
              aria-modal="true"
              aria-label={t('docs.version.delete')}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <p>{t('docs.version.deleteConfirm', { values: { seq: confirmDelete.docVersionSeq } })}</p>
              <div className="octo-member-row">
                <button
                  type="button"
                  className="octo-tb-btn"
                  disabled={busy}
                  onClick={() => void onDelete(confirmDelete)}
                >
                  {t('docs.version.delete')}
                </button>
                <button
                  type="button"
                  className="octo-tb-btn"
                  disabled={busy}
                  onClick={() => setConfirmDelete(null)}
                >
                  {t('docs.version.cancel')}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {selected && (
        <div className="octo-modal-overlay" role="presentation" onMouseDown={closePreview}>
          <div
            className="octo-modal docs-version-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-label={compare ? t('docs.version.compareTitle') : t('docs.version.previewTitle')}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="octo-member-row">
              <h4 style={{ flex: 1, margin: 0 }}>
                {compare ? t('docs.version.compareTitle') : t('docs.version.previewTitle')} — #{selected.docVersionSeq}
              </h4>
              {/* 「撤销本次修改」——只在这条退路上出现,且只对 Bot 快照。
                  文档侧走 renderBotDiff(BotEditDiffView 自带撤销);表格没有那个视图,走的是
                  这个通用对比弹窗,于是「看到了 Bot 改了什么,却没法撤销」——用户报的正是这个。
                  语义上完全一致:恢复 Bot 改前的安全快照 == 撤销它这次修改。所以直接接现成的
                  恢复流程(确认框 / busy 守卫 / 错误映射都已存在且有测试),不新造接口。
                  先 closePreview 再开确认框:两个都是浮层,叠着开会把确认框压在下面。 */}
              {myRestore && isBotEditVersion(selected) && (
                <button
                  type="button"
                  className="octo-tb-btn octo-version-danger-btn"
                  disabled={busy}
                  onClick={() => {
                    const target = selected
                    closePreview()
                    setConfirmRestore(target)
                  }}
                >
                  {t('docs.botDiff.revertAll')}
                </button>
              )}
              {canCompare && (
                <button
                  type="button"
                  className="octo-tb-btn"
                  disabled={previewState !== 'ready'}
                  onClick={() => setCompare((c) => !c)}
                >
                  {compare ? t('docs.version.showPreview') : t('docs.version.compare')}
                </button>
              )}
              <button type="button" className="octo-tb-btn" onClick={closePreview}>
                {t('docs.version.close')}
              </button>
            </div>

            <div className="docs-version-preview-modal-body">
              {previewState === 'loading' && <p className="octo-loading">{t('docs.version.loadingPreview')}</p>}
              {previewState === 'error' && (
                <div className="octo-version-preview-error">
                  <p className="octo-member-error">{t(previewErr)}</p>
                  <button type="button" className="octo-tb-btn" onClick={() => selected && void onPreview(selected)}>
                    {t('docs.version.previewRetry')}
                  </button>
                </div>
              )}
              {previewState === 'ready' && previewData != null && !compare && renderPreview(previewData)}
              {previewState === 'ready' && previewData != null && compare && renderDiff && renderDiff(previewData, currentForDiff)}
            </div>
          </div>
        </div>
      )}
      {/* Bot-edit diff modal. Same overlay chrome as the preview modal (centered, overlay-close,
          Esc) so the two read as one surface; the BODY is entirely host-injected — the shell knows
          nothing about how a bot edit is diffed or undone. */}
      {botDiffFor && renderBotDiff && (
        <div className="octo-modal-overlay" role="presentation" onMouseDown={closeBotDiff}>
          <div
            className="octo-modal docs-bot-diff-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t('docs.botDiff.title')}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {renderBotDiff(botDiffFor, {
              close: closeBotDiff,
              restored: () => void onBotDiffRestored(),
            })}
          </div>
        </div>
      )}
    </>
  )
}
