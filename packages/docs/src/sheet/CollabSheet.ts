// Collaborative spreadsheet assembly — the sheet counterpart of collab/createCollabEditor.ts.
//
// Owns exactly one Y.Doc + one HocuspocusProvider + one Univer instance +
// one UniverYjsBinding + one IndexeddbPersistence per sheet, and reuses the
// SAME documentName / collab-token / role / close-code machinery as the Tiptap
// editor path. The only sheet-specific parts are: (a) we mount Univer (not a
// Tiptap Editor) into a DOM container, and (b) the Y.Doc payload lives in the
// 'sheet' Y.Map (see binding.ts), not the Tiptap XmlFragment.
//
// Read-only enforcement note: writes from non-writers are rejected server-side
// by the backend's beforeHandleMessage (§4.5). A UI-level read-only lock for
// Univer is a follow-up (needs the Univer permission Facade verified first);
// for V1 the backend is the authority, same trust boundary as the editor path.

import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { IndexeddbPersistence } from 'y-indexeddb'
import { LocaleType, mergeLocales, ICommandService, CommandType, IContextService, FOCUSING_COMMON_DRAWINGS } from '@univerjs/core'
import { IMenuManagerService, RibbonInsertGroup, MenuItemType, IFontService } from '@univerjs/ui'
import { createUniver } from './createUniver.ts'
import { sanitizeLinkHref } from '../editor/sanitize.ts'
import { MathFormula, OCTO_MATH_FORMULA_KEY } from './floatDom/MathFormula.tsx'
import { MentionChip, OCTO_MENTION_CHIP_KEY } from './floatDom/MentionChip.tsx'
import { setFormulaSaveHandler, setDrawingBlurHandler, setFormulaResizeHandler, setFormulaStyleHandler, setFormulaDeleteHandler, requestFormulaPicker } from './floatDom/formulaBridge.ts'
import { PiIcon, OCTO_FORMULA_PI_ICON_KEY } from './floatDom/PiIcon.tsx'
import { AtIcon, OCTO_MENTION_AT_ICON_KEY } from './AtIcon.tsx'
import { requestSheetMentionOpen } from './sheetMentionBridge.ts'

/** The single merged formula ribbon entry: a π button that opens the React formula picker. */
const OCTO_FORMULA_MENU_ID = 'octo.menu.insert-formula'
const OCTO_FORMULA_PICKER_CMD = 'octo.command.formula.picker'

/** The @-mention ribbon entry: an @ button that opens the cell mention picker (next to π). */
const OCTO_MENTION_MENU_ID = 'octo.menu.insert-mention'
const OCTO_MENTION_CMD = 'octo.command.mention.open'
// Sheet gutter sizes used to convert a (row,col) cell into scene coords for the mention chip anchor
// (Univer's default row-header width / column-header height).
const OCTO_MENTION_ROW_HEADER_W = 40
const OCTO_MENTION_COL_HEADER_H = 20
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import sheetsCoreZhCN from '@univerjs/preset-sheets-core/locales/zh-CN'
import '@univerjs/preset-sheets-core/lib/index.css'
// Drawing (insert image / float shapes) + Table (native table objects) presets. These are
// OSS `@univerjs/*` packages — not the paid `@univerjs-pro/*` ones — so re-adding them keeps
// the "no pro deps" invariant from createUniver.ts intact. Drawing defaults to the built-in
// IImageIoService (base64-inline image storage), so no upload backend is required to insert.
import { UniverSheetsDrawingPreset } from '@univerjs/preset-sheets-drawing'
import { ISheetDrawingService } from '@univerjs/preset-sheets-drawing'
import { IDrawingManagerService } from '@univerjs/drawing'
import sheetsDrawingZhCN from '@univerjs/preset-sheets-drawing/locales/zh-CN'
import '@univerjs/preset-sheets-drawing/lib/index.css'
// Hyperlink (insert link) preset — OSS, same pattern as drawing. Hyperlinks live in the
// SHEET_HYPER_LINK_PLUGIN resource (not cell data), so persistence/replication rides a dedicated
// Yjs sync in binding.ts (fed the HyperLinkModel resolved from the injector below).
import { UniverSheetsHyperLinkPreset } from '@univerjs/preset-sheets-hyper-link'
import { HyperLinkModel } from '@univerjs/preset-sheets-hyper-link'
import sheetsHyperLinkZhCN from '@univerjs/preset-sheets-hyper-link/locales/zh-CN'
import '@univerjs/preset-sheets-hyper-link/lib/index.css'

import { buildDocumentName } from '../documentName/index.ts'
import { resolveCollabWsUrl } from '../config.ts'
import { t } from '../octoweb/index.ts'
import { canEdit, type Role } from '../auth/roles.ts'
import { getCollabToken, getCollabTokenEntry, disposeToken } from '../auth/collabToken.ts'
import { cacheKey, deleteDatabaseAwait, type DocScope } from '../offline/cache.ts'
import { RoleController } from '../collab/statelessRole.ts'
import { CloseCodeMachine, type CloseEvent } from '../collab/closeCode.ts'
import type { ConnState, TerminalState } from '../collab/createCollabEditor.ts'
import { UniverYjsBinding, type DrawingReaderLike, type HyperLinkModelLike } from './binding.ts'
import { SheetCursorOverlay } from './sheetCursors.ts'
import { SheetCommentMarkers, type MarkedCell } from './sheetCommentMarkers.ts'
import { SheetCellMention, stripTrailingQuery } from './sheetMention.ts'
import type { MentionItem } from '../mentions/source.ts'
import { colorFromId } from '../awareness/presence.ts'

/** 0-based column index → spreadsheet letters (0→A, 26→AA). */
function colToA1(col: number): string {
  let n = col
  let s = ''
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

/**
 * Decode a `data:<mime>;base64,<data>` URL into a File. Used to feed imported WPS cell images into
 * the cell-image facade as a File (the string/URL path 400s on data: URLs). Returns null if the
 * input isn't a base64 data URL.
 */
function dataUrlToFile(dataUrl: string, name: string): File | null {
  const m = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.+)$/s.exec(dataUrl)
  if (!m) return null
  try {
    const mime = m[1]
    const bin = atob(m[2])
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const ext = mime.split('/')[1]?.split('+')[0] || 'png'
    return new File([bytes], `${name}.${ext}`, { type: mime })
  } catch {
    return null
  }
}

/**
 * Whether the app is in dark mode. The octo app toggles `body[theme-mode="dark"]`
 * (dmworkbase App.tsx) across web/desktop; we honor that first, then fall back to
 * the OS `prefers-color-scheme`. Used to render the Univer grid to match the app.
 */
function isDarkTheme(): boolean {
  try {
    if (typeof document !== 'undefined') {
      const mode = document.body.getAttribute('theme-mode')
      if (mode) return mode === 'dark'
    }
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

export interface CollabSheetOptions {
  uid: string
  space: string
  folder: string
  doc: string
  /** Stable doc id for REST (members, etc.). */
  docId: string
  user: { id: string; name: string; avatar?: string }
  /** The DOM element Univer renders into. Must be attached + sized by the caller. */
  container: HTMLElement
  /** Disable local persistence for high-confidentiality docs (§6.4). */
  disableOfflineCache?: boolean
  onRole?: (role: Role) => void
  onConnState?: (state: ConnState) => void
  onTerminal?: (state: TerminalState) => void
}

export class CollabSheet {
  readonly documentName: string
  readonly ydoc: Y.Doc
  readonly provider: HocuspocusProvider
  readonly persistence: IndexeddbPersistence | null

  private readonly univer: ReturnType<typeof createUniver>['univer']
  private readonly univerAPI: ReturnType<typeof createUniver>['univerAPI']
  private readonly binding: UniverYjsBinding
  /** Hyperlink model (from the injector), so importCells can apply imported links; null if unavailable. */
  private hyperLinkModel: HyperLinkModelLike | null = null
  /** Command + sheet-drawing services (from the injector) — used to persist a formula edit back into
   *  its DRAWING_DOM record (which the drawing Yjs sync then replicates). Null if unavailable. */
  private commandService: { executeCommand(id: string, params?: unknown): unknown } | null = null
  private sheetDrawingSvc: {
    getDrawingByParam(p: { unitId: string; subUnitId: string; drawingId: string }): {
      data?: Record<string, unknown>
      transform?: Record<string, unknown>
      drawingType?: number
    } | null | undefined
  } | null = null
  private cursors: SheetCursorOverlay | null = null
  private commentMarkers: SheetCommentMarkers | null = null
  private cellMention: SheetCellMention | null = null
  private commentMarkerClick: ((row: number, col: number, sheetId: string) => void) | null = null
  private commentMenuClick: (() => void) | null = null
  private readonly cacheKeyStr: string
  private readonly roleController: RoleController
  private readonly closeMachine: CloseCodeMachine
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private sealTimer: ReturnType<typeof setTimeout> | null = null

  private currentRole: Role
  private destroyed = false

  private constructor(opts: CollabSheetOptions, initialRole: Role, initialEpoch: number, wsUrl: string) {
    const scope: DocScope = { uid: opts.uid, space: opts.space, folder: opts.folder, doc: opts.doc }
    this.documentName = buildDocumentName(opts.space, opts.folder, opts.doc)
    this.cacheKeyStr = cacheKey(scope)
    this.currentRole = initialRole

    // 1) single Y.Doc
    this.ydoc = new Y.Doc()

    // 2) local persistence before network
    this.persistence = opts.disableOfflineCache
      ? null
      : new IndexeddbPersistence(this.cacheKeyStr, this.ydoc)

    // 3) provider — connect:false; we wire listeners then connect.
    this.provider = new HocuspocusProvider({
      url: wsUrl,
      name: this.documentName,
      document: this.ydoc,
      token: () => getCollabToken(this.documentName),
      connect: false,
    })

    // Publish presence identity into Yjs awareness so the shared PresenceBar shows this
    // user's avatar (the doc gets this for free via Tiptap's CollaborationCaret; the sheet
    // has no such extension, so we set the same `user` field ourselves). color is a stable
    // #6-hex from the uid — matches the backend's validateAwarenessStates (id/name/color) check.
    this.provider.awareness?.setLocalStateField('user', {
      id: opts.user.id,
      name: opts.user.name,
      color: colorFromId(opts.user.id),
      avatar: opts.user.avatar,
    })

    // 4) Univer instance mounted into the caller's container + an empty workbook,
    //    then bind it to the shared Y.Doc. The binding seeds from whichever side
    //    has data (existing session vs fresh book).
    // Locale patch: @univerjs/sheets-ui@0.25.1's zh-CN bundle is missing the
    // `sheets-ui.info` block (error / forceStringInfo), so the runtime renders the
    // raw message keys (e.g. the "number stored as text" green-corner tooltip).
    // We supply the two strings here — but mergeLocales is a SHALLOW merge
    // (Object.assign under the hood), so passing `{ 'sheets-ui': { info } }` as a
    // separate arg would REPLACE the entire `sheets-ui` namespace with just `{ info }`,
    // wiping toolbar/align/border translations. Instead, merge the base locales first,
    // then deep-merge only the `info` sub-block into `sheets-ui`.
    // Titles for our custom "insert formula" dropdown + presets (Univer's LocaleService resolves the
    // menu `title` keys against these merged locales — an unknown key would render raw).
    const octoMenuZhCN = {
      octo: {
        insertFormula: t('docs.sheet.formula.insert'),
        formulaMenu: t('docs.sheet.formula.menu'),
        mentionMenu: t('docs.sheet.mention.menu'),
        formula: {
          circleArea: t('docs.sheet.formula.circleArea'),
          binomial: t('docs.sheet.formula.binomial'),
          sumExpansion: t('docs.sheet.formula.sumExpansion'),
          fourier: t('docs.sheet.formula.fourier'),
          pythagorean: t('docs.sheet.formula.pythagorean'),
          quadratic: t('docs.sheet.formula.quadratic'),
          taylor: t('docs.sheet.formula.taylor'),
          trig1: t('docs.sheet.formula.trig1'),
          trig2: t('docs.sheet.formula.trig2'),
          newFormula: t('docs.sheet.formula.newFormula'),
          latex: t('docs.sheet.formula.latex'),
        },
      },
    }
    const baseZhCN = mergeLocales(sheetsCoreZhCN, sheetsDrawingZhCN, sheetsHyperLinkZhCN, octoMenuZhCN) as Record<string, unknown>
    const mergedZhCN = {
      ...baseZhCN,
      'sheets-ui': {
        ...(baseZhCN['sheets-ui'] as Record<string, unknown> | undefined),
        info: {
          ...((baseZhCN['sheets-ui'] as { info?: Record<string, unknown> } | undefined)?.info),
          error: t('docs.sheet.info.error'),
          forceStringInfo: t('docs.sheet.info.forceStringInfo'),
        },
      },
    }
    const { univer, univerAPI } = createUniver({
      locale: LocaleType.ZH_CN,
      locales: { [LocaleType.ZH_CN]: mergedZhCN },
      darkMode: isDarkTheme(),
      presets: [
        UniverSheetsCorePreset({
          container: opts.container,
          // Hide the built-in "数据" (Data) ribbon tab. Its only entry is
          // "文本转数字" (text-to-number), which we don't want. Hiding the toolbar
          // menu item empties the DATA ribbon group, so the whole 数据 tab disappears;
          // we also hide the right-click counterpart for consistency.
          menu: {
            'sheet.toolbar.text-to-number': { hidden: true },
            'sheet.contextMenu.text-to-number': { hidden: true },
          },
        }),
        // Insert image / drawing objects. collaboration:false keeps the OSS base64 image
        // service (no pro collab client). NOTE: binding.ts does not yet sync drawing
        // mutations through Yjs, so inserted images are local-only until that lands.
        UniverSheetsDrawingPreset(),
        // Insert hyperlink (OSS). Hyperlinks live in the SHEET_HYPER_LINK_PLUGIN resource (not cell
        // data); persistence + replication ride the hyperlink Yjs sync in binding.ts (the injected
        // HyperLinkModel below). The cell's visible TEXT is separately in cell.v.
        UniverSheetsHyperLinkPreset(),
      ],
    })
    this.univer = univer
    // Create the workbook with an explicit, generously-sized default sheet. An empty
    // `createWorkbook({})` gets Univer's default worksheet of only 20 columns (A–T), so a
    // formula referencing anything from column U onward (e.g. `=A1+Z99`) can't resolve the
    // reference and yields `#NAME?` instead of treating the empty cell as 0. Declaring
    // 1000×100 makes those references valid empty cells. This does NOT inflate sync cost:
    // binding.ts scans only the used (content) range, not the declared dimensions.
    univerAPI.createWorkbook({
      id: 'octo-sheet',
      sheetOrder: ['octo-sheet-1'],
      sheets: {
        'octo-sheet-1': {
          id: 'octo-sheet-1',
          name: 'Sheet1',
          rowCount: 1000,
          columnCount: 100,
          cellData: {},
        },
      },
    })
    this.univerAPI = univerAPI
    // Resolve services from Univer's DI container. `__getInjector` is Univer's own accessor
    // (FUniver.newAPI uses it); wrapped defensively so a Univer API change can't break sheet load.
    let drawingReader: DrawingReaderLike | null = null
    let hyperLinkModel: HyperLinkModelLike | null = null
    try {
      const injector = (univer as unknown as { __getInjector?: () => { get(id: unknown): unknown } }).__getInjector?.()
      // Drop 微软雅黑 (Microsoft YaHei) from the font picker. It's a Windows-only font with no
      // macOS name-equivalent, and Chromium refuses to honor an @font-face alias for that reserved
      // name (unlike SimSun/SimHei/… which alias fine — see editor/styles.css), so on non-Windows
      // clients it can only ever fall back to the default face + show a "not installed" warning. This
      // just prunes the picker option (reactive via IFontService.fonts$); it does NOT touch any cell's
      // stored font value, so existing/imported "Microsoft YaHei" cells and xlsx export are unaffected.
      const fontSvc = injector?.get(IFontService) as {
        removeFont?: (v: string) => boolean
        addFont?: (f: { value: string; label: string; category?: string }) => void
        getFontByValue?: (v: string) => unknown
      } | undefined
      if (typeof fontSvc?.removeFont === 'function') fontSvc.removeFont('Microsoft YaHei')
      // Extend the picker with common macOS-available CJK + Latin fonts (Univer's built-in list is
      // only ~12). `label` is shown verbatim (localeService.t falls through unknown keys); `value` is
      // the CSS font-family the cell stores/exports. These use native font names that render directly
      // on macOS — cross-platform @font-face aliasing (for the ones we keep) is a follow-up.
      if (typeof fontSvc?.addFont === 'function') {
        const EXTRA_FONTS = [
          { value: 'PingFang SC', label: t('docs.sheet.fontLabels.pingfang'), category: 'sans-serif' },
          { value: 'Hiragino Sans GB', label: t('docs.sheet.fontLabels.hiraginoSansGB'), category: 'sans-serif' },
          { value: 'STXihei', label: t('docs.sheet.fontLabels.stxihei'), category: 'sans-serif' },
          { value: 'Yuanti SC', label: t('docs.sheet.fontLabels.yuanti'), category: 'sans-serif' },
          { value: 'Hannotate SC', label: t('docs.sheet.fontLabels.hannotate'), category: 'handwriting' },
          { value: 'HanziPen SC', label: t('docs.sheet.fontLabels.hanzipen'), category: 'handwriting' },
          { value: 'Wawati SC', label: t('docs.sheet.fontLabels.wawati'), category: 'handwriting' },
          { value: 'Georgia', label: 'Georgia', category: 'serif' },
          { value: 'Palatino', label: 'Palatino', category: 'serif' },
          { value: 'Courier New', label: 'Courier New', category: 'monospace' },
          { value: 'Trebuchet MS', label: 'Trebuchet MS', category: 'sans-serif' },
          { value: 'Comic Sans MS', label: 'Comic Sans MS', category: 'handwriting' },
          { value: 'Impact', label: 'Impact', category: 'display' },
        ]
        for (const f of EXTRA_FONTS) {
          try { if (!fontSvc.getFontByValue?.(f.value)) fontSvc.addFont(f) } catch { /* already present */ }
        }
      }
      const svc = injector?.get(ISheetDrawingService) as { getDrawingData?: unknown; getDrawingByParam?: unknown } | undefined
      if (svc && typeof svc.getDrawingData === 'function') drawingReader = svc as unknown as DrawingReaderLike
      if (svc && typeof svc.getDrawingByParam === 'function') this.sheetDrawingSvc = svc as never
      // The drawing MANAGER (distinct from the sheet drawing service) owns selection/focus. We use it
      // to clear the selection when a formula field is focused, so Univer's move/delete-drawing key
      // shortcuts have no target while editing (keys then act inside the formula). Wired below.
      const dm = injector?.get(IDrawingManagerService) as { focusDrawing?: (p: unknown) => void } | undefined
      // IContextService owns the `FOCUSING_COMMON_DRAWINGS` context key. Univer's move/delete-drawing
      // shortcuts (ARROW_*/DELETE in @univerjs/sheets-drawing-ui) are gated on that key being true —
      // it's set true when a drawing's transform control is created and stays true until the control
      // is cleared. Clicking INTO the formula doesn't clear a pre-existing selection, so the key stays
      // true and the arrows/Delete hijack the box. Forcing it false when the formula field focuses
      // disables exactly those shortcuts (event-driven, so it stays false through the edit) — the keys
      // then act inside the formula. Univer re-sets it true on the next real drawing selection.
      const ctx = injector?.get(IContextService) as { setContextValue?: (k: string, v: boolean) => void } | undefined
      if ((dm && typeof dm.focusDrawing === 'function') || (ctx && typeof ctx.setContextValue === 'function')) {
        setDrawingBlurHandler(() => {
          try {
            ctx?.setContextValue?.(FOCUSING_COMMON_DRAWINGS, false)
            dm?.focusDrawing?.([])
          } catch {
            /* best-effort */
          }
        })
      }
      // Same DI route for the hyperlink model, so the binding can read/write links for sync.
      const hl = injector?.get(HyperLinkModel) as { getSubUnit?: unknown; linkUpdate$?: unknown } | undefined
      if (hl && typeof hl.getSubUnit === 'function' && hl.linkUpdate$) hyperLinkModel = hl as unknown as HyperLinkModelLike
      // Register ONE formula entry in the INSERT ribbon tab: a π button that opens the React formula
      // picker (preset previews + the two builders). Univer can't render formula previews inside its
      // native dropdown, so the rich dropdown is our own component (see FormulaPicker).
      const cmd = injector?.get(ICommandService) as { registerCommand?: (c: unknown) => void; executeCommand?: unknown } | undefined
      if (cmd && typeof cmd.executeCommand === 'function') this.commandService = cmd as never
      const menuMgr = injector?.get(IMenuManagerService) as { mergeMenu?: (s: unknown) => void } | undefined
      if (cmd?.registerCommand && menuMgr?.mergeMenu) {
        cmd.registerCommand({
          id: OCTO_FORMULA_PICKER_CMD,
          type: CommandType.COMMAND,
          handler: () => {
            requestFormulaPicker()
            return true
          },
        })
        // The π icon component the ribbon button renders (resolved from the ComponentManager by key).
        try {
          ;(univerAPI as unknown as { registerComponent?: (k: string, c: unknown) => void }).registerComponent?.(
            OCTO_FORMULA_PI_ICON_KEY,
            PiIcon,
          )
        } catch {
          /* icon optional */
        }
        menuMgr.mergeMenu({
          [RibbonInsertGroup.OTHERS]: {
            [OCTO_FORMULA_MENU_ID]: {
              order: 99,
              // Clicking a BUTTON menu item executes the command whose id === the item id.
              menuItemFactory: () => ({
                id: OCTO_FORMULA_PICKER_CMD,
                type: MenuItemType.BUTTON,
                title: 'octo.formulaMenu',
                tooltip: 'octo.formulaMenu',
                icon: OCTO_FORMULA_PI_ICON_KEY,
              }),
            },
          },
        })
        // The @-mention ribbon button, sitting next to π. Opens the cell mention picker instead of
        // requiring the user to type `@` inside a cell.
        cmd.registerCommand({
          id: OCTO_MENTION_CMD,
          type: CommandType.COMMAND,
          handler: () => {
            requestSheetMentionOpen()
            return true
          },
        })
        try {
          ;(univerAPI as unknown as { registerComponent?: (k: string, c: unknown) => void }).registerComponent?.(
            OCTO_MENTION_AT_ICON_KEY,
            AtIcon,
          )
        } catch {
          /* icon optional */
        }
        menuMgr.mergeMenu({
          [RibbonInsertGroup.OTHERS]: {
            [OCTO_MENTION_MENU_ID]: {
              order: 100, // just after the π formula entry (order 99)
              menuItemFactory: () => ({
                id: OCTO_MENTION_CMD,
                type: MenuItemType.BUTTON,
                title: 'octo.mentionMenu',
                tooltip: 'octo.mentionMenu',
                icon: OCTO_MENTION_AT_ICON_KEY,
              }),
            },
          },
        })
      }
    } catch {
      drawingReader = null
      hyperLinkModel = null
    }
    this.hyperLinkModel = hyperLinkModel
    // Register the editable math-formula float-DOM component (every collaborating client registers
    // the same key so a synced formula drawing renders). Wire inline edits (latex + font size) to
    // persist through the drawing model.
    try {
      ;(univerAPI as unknown as { registerComponent?: (k: string, c: unknown) => void }).registerComponent?.(
        OCTO_MATH_FORMULA_KEY,
        MathFormula,
      )
      setFormulaSaveHandler((id, latex, fontSize) => this.updateFormula(id, latex, fontSize))
      setFormulaResizeHandler((id, w, h) => this.resizeFormula(id, w, h))
      setFormulaStyleHandler((id, patch) => this.styleFormula(id, patch))
      setFormulaDeleteHandler((id) => this.deleteFormula(id))
    } catch {
      // formula feature unavailable — sheet still loads
    }
    // Register the @-mention chip float-DOM component (same key on every client so a synced mention
    // drawing renders). The chip is inserted by insertMentionChip when a mention is picked.
    try {
      ;(univerAPI as unknown as { registerComponent?: (k: string, c: unknown) => void }).registerComponent?.(
        OCTO_MENTION_CHIP_KEY,
        MentionChip,
      )
    } catch {
      // mention chip unavailable — sheet still loads (picker just won't render a chip)
    }
    // Pass a live write-gate: readers / downgraded users must NOT write to the shared Y.Doc
    // (the server rejects their writes anyway, but an ungated binding would still persist the
    // edit to local IndexedDB and replay it on a later privilege upgrade — B3).
    // Defer the binding's initial seed/registry decision until local (IndexedDB) state has
    // replayed. Constructing eagerly would let a writer reopening an EXISTING sheet on a cold
    // cache see an empty-looking Y.Doc, fall into the "brand-new" branch, and author
    // `sheetList.default = {name:'Sheet1'}` — which LWW then merges against the about-to-load
    // persisted registry and can revert a renamed first sheet back to "Sheet1" (P1-B). Observers
    // attach eagerly inside the binding, so anything that syncs in during the wait is captured;
    // initialSync() is idempotent and only runs the seed decision once, against the settled doc.
    this.binding = new UniverYjsBinding(univerAPI, this.ydoc, () => canEdit(this.currentRole), {
      deferInitialSync: true,
    }, drawingReader, hyperLinkModel)
    // Drive it after the local cache has replayed (whenSynced), or immediately if offline cache
    // is disabled (no persistence layer to wait on). A one-shot guard + the binding's own
    // idempotency make a later provider 'synced' or the timeout fallback harmless.
    if (this.persistence) {
      let sealed = false
      const seal = (networkSynced: boolean) => {
        // The registry-authoring decision (brand-new-author branch) may only run when the NETWORK
        // is synced. A local-only signal (whenSynced on a cold/empty cache) passes networkSynced
        // =false, so binding.initialSync defers authoring and does NOT mark itself done; a later
        // provider 'synced' seal (networkSynced=true) then authors against the settled doc. Non-
        // authoring paths (join existing / legacy V1 / reader) complete on the first signal
        // regardless, and `sealed` flips only once initialSync actually commits (initialSynced).
        if (this.destroyed) return
        if (sealed && this.binding.hasInitialSynced()) return
        this.binding.initialSync(networkSynced)
        if (this.binding.hasInitialSynced()) sealed = true
      }
      // Local replay signal — network is authoritative only if the provider ALSO happens to be
      // synced already; otherwise this is a local-only wake and must not author.
      void this.persistence.whenSynced.then(() => seal(this.provider.synced))
      if (this.provider.synced) seal(true)
      else this.provider.on('synced', () => seal(true))
      // Fallback: never leave the sheet blank if neither signal resolves. Author only if the
      // network is actually synced by then; otherwise this is a no-op and a later 'synced' seals.
      this.sealTimer = setTimeout(() => seal(this.provider.synced), 3000)
    } else {
      // No offline cache: the provider is the only source of truth. Seal on its sync so we never
      // author a registry over a doc whose persisted state hasn't arrived yet.
      if (this.provider.synced) this.binding.initialSync(true)
      else {
        let sealed = false
        const seal = () => {
          if (sealed || this.destroyed) return
          sealed = true
          this.binding.initialSync(true)
        }
        this.provider.on('synced', seal)
        this.sealTimer = setTimeout(seal, 3000)
      }
    }
    // UI read-only lock so a reader can't even type (mirrors the editor's editable gate).
    this.setUniverEditable(canEdit(initialRole))

    // Add a "评论" item to the cell (main-area) right-click menu, in its "others" group.
    // createMenu/appendTo are public Univer facade methods (no internal tokens needed);
    // the action opens the comment panel for the right-clicked cell via a handler the
    // view registers. Wrapped defensively so a Univer API change can't break sheet load.
    try {
      const api = univerAPI as unknown as {
        createMenu(item: { id: string; title: string; action: () => void }): {
          appendTo(path: string | string[]): void
        }
      }
      api
        .createMenu({ id: 'octo.sheet.comment', title: t('docs.sheet.comment.menu'), action: () => this.commentMenuClick?.() })
        .appendTo(['contextMenu.mainArea', 'contextMenu.others'])
    } catch {
      // Univer menu API unavailable/changed — skip the context-menu entry (panel still works).
    }
    // Remote-cursor overlay: shows other users' active cells (color + name tag). It reads the
    // active LOGICAL sheet id (via the resolver) both to tag the local user's broadcast cursor
    // and to filter remote cursors to the current sheet, so a peer's Sheet2 cursor never paints
    // over your Sheet1.
    if (this.provider.awareness) {
      this.cursors = new SheetCursorOverlay(
        univerAPI as unknown as ConstructorParameters<typeof SheetCursorOverlay>[0],
        this.provider.awareness as unknown as ConstructorParameters<typeof SheetCursorOverlay>[1],
        opts.container,
        () => this.binding.activeLogicalId(),
      )
    }
    // Comment-marker overlay: a corner badge on each commented cell (fed by the panel).
    // Clicking a badge routes through a handler the view registers (open panel + focus).
    // The resolver lets the overlay draw only badges whose logical sheet is active.
    this.commentMarkers = new SheetCommentMarkers(
      univerAPI as unknown as ConstructorParameters<typeof SheetCommentMarkers>[0],
      opts.container,
      (row, col, sheetId) => this.commentMarkerClick?.(row, col, sheetId),
      () => this.binding.activeLogicalId(),
    )
    // Cell @-mention: `@` in a cell / the ribbon @ button → shared mention popup → drops a
    // float-DOM mention chip (MentionChip) on the cell. Rendered by our own React component (like
    // the comment MentionText), so the chip is blue, @user is inert, @doc opens the doc, and there
    // is no hyperlink URL popup. OSS-only; degrades to no-op if Univer's float-DOM API drifts.
    this.cellMention = new SheetCellMention(
      univerAPI as unknown as ConstructorParameters<typeof SheetCellMention>[0],
      opts.container,
      opts.space,
      (item, cell, ctx) => this.insertMentionChip(item, cell, ctx),
      () => canEdit(this.currentRole),
    )
    // Role controller: runtime stateless role changes (monotonic epoch).
    this.roleController = new RoleController({
      documentName: this.documentName,
      initialRole,
      initialEpoch,
      onRole: (role) => {
        this.currentRole = role
        // Toggle the Univer UI read-only lock to match the new role (backend also enforces).
        this.setUniverEditable(canEdit(role))
        opts.onRole?.(role)
      },
    })

    // Close-code state machine: the only auth-recovery source is event.code.
    this.closeMachine = new CloseCodeMachine({
      disposeToken: () => disposeToken(this.documentName),
      connect: () => this.provider.connect(),
      disconnect: () => this.provider.disconnect(),
      goLogin: () => opts.onTerminal?.({ kind: 'login' }),
      showForbidden: () => opts.onTerminal?.({ kind: 'deleted' }),
      exitDocument: () => opts.onTerminal?.({ kind: 'not-found' }),
      showLockedOrArchived: () => opts.onTerminal?.({ kind: 'locked' }),
      clearDocCache: () => {
        void this.clearCache()
      },
      rollbackPending: () => {
        // No optimistic-edit buffer for sheets, but a forbidden/epoch close means the user
        // just lost write access — lock the grid read-only so nothing more can be typed.
        this.setUniverEditable(false)
      },
      onTransientClose: () => {
        opts.onConnState?.('disconnected')
      },
      deferReconnect: ({ delayMs }) => {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
        this.reconnectTimer = setTimeout(() => {
          if (!this.destroyed && !this.closeMachine.isTerminated()) this.provider.connect()
        }, delayMs)
      },
      reportServerError: (event) => {
        void event
      },
      backoffDelay: () => 5_000,
    })

    // Listeners registered BEFORE connect.
    this.provider.on('status', (e: { status: ConnState }) => opts.onConnState?.(e.status))
    this.provider.on('synced', () => this.closeMachine.onAuthStable())
    this.provider.on('authenticated', () => this.closeMachine.onAuthStable())
    this.provider.on('stateless', (e: { payload: string }) => {
      this.roleController.handleStatelessFrame(e.payload)
    })
    this.provider.on('close', (e: { event: CloseEvent }) => {
      this.closeMachine.handleClose(e.event)
    })

    // Emit the initial role immediately so the UI (e.g. the members panel, which is
    // admin-only) knows the caller's role without waiting for a runtime stateless frame.
    opts.onRole?.(initialRole)

    // Now connect.
    this.provider.connect()
  }

  /** Identity-first construction (§6.1): confirm identity + role BEFORE wiring network. */
  static async create(opts: CollabSheetOptions): Promise<CollabSheet> {
    const documentName = buildDocumentName(opts.space, opts.folder, opts.doc)
    const entry = await getCollabTokenEntry(documentName)
    const wsUrl = resolveCollabWsUrl(entry.collabWsUrl)
    return new CollabSheet(opts, entry.role, entry.permission_epoch, wsUrl)
  }

  getRole(): Role {
    return this.currentRole
  }

  /**
   * Toggle the whole workbook read-only via Univer's WorkbookEditablePermission. Readers /
   * downgraded users get a locked grid (can't type). Defensive: a Univer API change must not
   * break sheet load, and the binding write-gate is the authoritative stop regardless.
   */
  private setUniverEditable(editable: boolean): void {
    try {
      ;(this.univerAPI.getActiveWorkbook() as unknown as { setEditable?: (v: boolean) => void } | null)?.setEditable?.(
        editable,
      )
    } catch {
      // ignore — write-gate in the binding still prevents unauthorized writes
    }
  }

  /**
   * Update this user's presence display name (avatars + remote-cursor tag). Called once the
   * member-name lookup resolves, since the name isn't known when the sheet is first created.
   */
  updatePresenceName(name: string): void {
    if (!name) return
    const cur = (this.provider.awareness?.getLocalState()?.user ?? {}) as Record<string, unknown>
    this.provider.awareness?.setLocalStateField('user', { ...cur, name })
  }

  /**
   * The currently-selected cell as a stable anchor. `key` matches the Y.Map cell key
   * (`${logicalSheetId}!${row}:${col}`) used for comment anchoring; `a1` is the human A1 label.
   * The sheet segment is the STABLE logical id (not Univer's per-client sheet id) so a comment
   * authored on Sheet2 anchors to Sheet2 for every client — see binding.ts multi-sheet identity.
   */
  /** Open the cell @-mention picker (ribbon @ button). Wired by SheetView keyed on the live sheet.
   *  Gated on the LIVE role: a reader (or a writer downgraded at runtime) must not be able to open
   *  the picker, or they'd insert a local-only "phantom" chip the Yjs write-gate silently drops. */
  openMentionMenu(): void {
    if (!canEdit(this.currentRole)) return
    this.cellMention?.openMenu()
  }

  /** Insert a picked mention into the target cell (overlay click / button-mode keyboard).
   *  Role-gated too — the picker could have been opened before a writer→reader downgrade. */
  pickMention(item: MentionItem): void {
    if (!canEdit(this.currentRole)) return
    this.cellMention?.pick(item)
  }

  /** Dismiss the cell @-mention picker without a pick (overlay Escape / click-away). Resets the
   *  controller so the inline `@` trigger keeps working. */
  closeMention(): void {
    this.cellMention?.closeMenu()
  }

  getActiveCellRef(): { key: string; a1: string; sheetId: string } | null {
    const wb = this.univerAPI.getActiveWorkbook()
    if (!wb) return null
    const sheet = wb.getActiveSheet()
    if (!sheet) return null
    const range = sheet.getActiveRange()
    if (!range) return null
    const r = range.getRange()
    const row = r.startRow ?? 0
    const col = r.startColumn ?? 0
    const logicalId = this.binding.activeLogicalId()
    return { key: `${logicalId}!${row}:${col}`, a1: `${colToA1(col)}${row + 1}`, sheetId: logicalId }
  }

  /**
   * The active cell plus its on-screen rect (relative to `.octo-sheet-container`), for
   * anchoring an inline comment composer next to the cell — the sheet counterpart of the
   * doc editor's selection bubble. Rect matches the comment badge geometry exactly.
   */
  getActiveCellAnchor():
    | { row: number; col: number; a1: string; key: string; left: number; top: number; width: number; height: number }
    | null {
    const ref = this.getActiveCellRef()
    if (!ref) return null
    const rc = ref.key.split('!')[1]?.split(':')
    const row = Number(rc?.[0])
    const col = Number(rc?.[1])
    if (!Number.isInteger(row) || !Number.isInteger(col)) return null
    const rect = this.commentMarkers?.cellScreenRect(row, col)
    if (!rect) return null
    return { row, col, a1: ref.a1, key: ref.key, ...rect }
  }

  /**
   * Select + scroll to a cell (used to jump from a comment thread to its cell). When the
   * comment lives on a DIFFERENT logical sheet than the active one, switch to that sheet
   * first — otherwise the jump would activate a cell on the wrong sheet. `sheetId` is the
   * logical id from the comment anchor; omit it (legacy calls) to stay on the active sheet.
   */
  focusCell(row: number, col: number, sheetId?: string): void {
    if (sheetId) this.binding.activateLogical(sheetId)
    const sheet = this.univerAPI.getActiveWorkbook()?.getActiveSheet()
    if (!sheet) return
    try {
      sheet.getRange(row, col).activate()
    } catch {
      // out-of-range or not ready — ignore
    }
  }

  /**
   * Notify when the active cell changes (selection op). Fires with the same {key, a1, sheetId}
   * shape as getActiveCellRef. Used by the comment panel to highlight the thread anchored
   * to the just-selected cell. Returns a disposer.
   */
  onActiveCell(cb: (ref: { key: string; a1: string; sheetId: string } | null) => void): () => void {
    const d = this.univerAPI.onCommandExecuted((cmd: { id: string }) => {
      if (cmd.id === 'sheet.operation.set-selections') cb(this.getActiveCellRef())
    })
    return () => {
      try {
        d.dispose()
      } catch {
        // ignore
      }
    }
  }

  /**
   * Feed the set of commented cells to the marker overlay (called by the comment panel). Cells
   * carry their logical `sheetId`; the overlay draws only those on the active sheet so a badge
   * for a comment on Sheet2 never appears over Sheet1.
   */
  setCommentedCells(cells: MarkedCell[]): void {
    this.commentMarkers?.setCells(cells)
  }

  /**
   * Bulk-write imported cells (from an .xlsx upload) into the active sheet, starting at A1.
   * The binding then syncs them to the shared Y.Doc, so an import persists and replicates to
   * other clients like any edit. Clamped to the declared sheet size. Returns false if nothing
   * could be written.
   */
  /**
   * Import one or more parsed worksheets. The first reuses the workbook's active (default)
   * sheet; each subsequent one is created via insertSheet. Every setValues / insertSheet /
   * merge fires a command the binding observes, so the whole multi-sheet import replicates
   * + persists through Yjs. Returns true if any sheet applied.
   */
  async importCells(
    sheets: Array<{
      name?: string
      matrix: Array<Array<{ v?: unknown; f?: string; s?: Record<string, unknown> } | null>>
      merges?: Array<{ startRow: number; startColumn: number; endRow: number; endColumn: number }>
      drawings?: Array<{ source: string; col: number; row: number }>
      cellImages?: Array<{ row: number; col: number; source: string }>
      hyperlinks?: Array<{ row: number; col: number; url: string; display?: string }>
    }>,
  ): Promise<boolean> {
    const wb = this.univerAPI.getActiveWorkbook() as unknown as {
      getId?: () => string
      getActiveSheet: () => unknown
      insertSheet?: (name?: string) => unknown
    } | null
    if (!wb) return false
    const parsed = sheets.filter(
      (s) =>
        s.matrix.length > 0 ||
        (s.drawings?.length ?? 0) > 0 ||
        (s.cellImages?.length ?? 0) > 0 ||
        (s.hyperlinks?.length ?? 0) > 0,
    )
    if (parsed.length === 0) return false
    let anyApplied = false
    // insertImage is async (it loads the image to size it). We AWAIT every image before returning
    // so the caller only drops the pending import once images have actually landed — otherwise a
    // mount that gets torn down mid-import (StrictMode / import-navigation) would delete the pending
    // entry while the async insert was still in flight, and the image would be lost (cells survive
    // because they write to the Y.Doc synchronously; images did not).
    const imagePromises: Array<Promise<unknown>> = []
    parsed.forEach((ps, i) => {
      let ws: unknown
      if (i === 0) {
        ws = wb.getActiveSheet()
        if (ws && ps.name) {
          try {
            ;(ws as { setName?: (n: string) => void }).setName?.(ps.name)
          } catch {
            // ignore rename failure — content still imports
          }
        }
      } else {
        ws = wb.insertSheet?.(ps.name) ?? null
      }
      if (ws && ps.matrix.length > 0 && this.populateSheet(ws, ps.matrix, ps.merges ?? [])) anyApplied = true
      if (ws && ps.drawings?.length) {
        const dws = ws as { insertImage?: (url: string, col?: number, row?: number) => Promise<unknown> }
        for (const d of ps.drawings) {
          try {
            // Fire the async insert and track it so the caller can await all images landing.
            imagePromises.push(Promise.resolve(dws.insertImage?.(d.source, d.col, d.row)).catch(() => {}))
            anyApplied = true
          } catch {
            // ignore a single image that fails to insert
          }
        }
      }
      // WPS cell images → native Univer cell images (fit the cell, move with it), via the FRange
      // facade. We pass a File (not the data-URL string): the string path goes through
      // insertCellImageByUrl which fetches/validates the URL and 400s on a data: URL, whereas a
      // File routes through insertCellImageByFile — the same path the UI's "insert cell image" uses
      // (ImageIoService.saveImage, no fetch). Stored in cell.p, which the binding syncs.
      if (ws && ps.cellImages?.length) {
        const gws = ws as {
          getRange?: (row: number, col: number) => { insertCellImageAsync?: (file: File | string) => Promise<unknown> } | null
        }
        for (const ci of ps.cellImages) {
          const file = dataUrlToFile(ci.source, `cell-image-${ci.row}-${ci.col}`)
          if (!file) continue
          // insertCellImageAsync needs the per-render-unit SheetDrawingUpdateController, which only
          // registers once the sheet has rendered — during import the render unit may not be ready
          // yet (throws QuantityCheckError). Retry with backoff until it is (bounded so a genuinely
          // missing controller can't loop forever). Once it lands, SetRangeValues writes cell.p, which
          // the binding syncs — so the cell image persists + replicates like a user-inserted one.
          const attempt = async (): Promise<void> => {
            for (let i = 0; i < 8; i++) {
              const range = gws.getRange?.(ci.row, ci.col)
              if (range?.insertCellImageAsync) {
                try {
                  await range.insertCellImageAsync(file)
                  return
                } catch {
                  if (i === 7) return // give up after the last try
                }
              }
              await new Promise((r) => setTimeout(r, 200 * (i + 1)))
            }
          }
          imagePromises.push(attempt())
          anyApplied = true
        }
      }
      // Hyperlinks: apply via the model (deterministic id per cell so a re-import overwrites rather
      // than duplicates). Adding to the model fires linkUpdate$, which the binding syncs to Yjs so
      // the links persist + replicate like a user-inserted link. The cell TEXT came in via the matrix.
      if (ws && ps.hyperlinks?.length && this.hyperLinkModel) {
        const unitId = wb.getId?.()
        const subUnitId = (ws as { getSheetId?: () => string }).getSheetId?.()
        if (unitId && subUnitId) {
          for (const h of ps.hyperlinks) {
            // Defense-in-depth at the model-write boundary: even though xlsxImport already
            // whitelists the scheme, re-check here so nothing but http/https/mailto reaches the
            // HyperLinkModel (mirrors the editor's "sanitize at both boundaries" rule).
            const safeUrl = sanitizeLinkHref(h.url)
            if (!safeUrl) continue
            try {
              this.hyperLinkModel.addHyperLink(unitId, subUnitId, {
                id: `imp-${h.row}-${h.col}`,
                row: h.row,
                column: h.col,
                payload: safeUrl,
                ...(h.display !== undefined ? { display: h.display } : {}),
              })
              anyApplied = true
            } catch {
              // ignore a single link that fails to add
            }
          }
        }
      }
    })
    if (imagePromises.length) await Promise.allSettled(imagePromises)
    return anyApplied
  }

  /** Write one parsed matrix (+ merges) into a single Univer worksheet. */
  private populateSheet(
    sheetUnknown: unknown,
    matrix: Array<Array<{ v?: unknown; f?: string; s?: Record<string, unknown> } | null>>,
    merges: Array<{ startRow: number; startColumn: number; endRow: number; endColumn: number }>,
  ): boolean {
    const sheet = sheetUnknown as {
      getMaxRows?: () => number
      getMaxColumns?: () => number
      getRange: (r: number, c: number, rows?: number, cols?: number) => unknown
    }
    if (matrix.length === 0) return false
    const maxRows = sheet.getMaxRows?.() ?? matrix.length
    const maxCols = sheet.getMaxColumns?.() ?? 0
    const rows = Math.min(matrix.length, maxRows)
    let cols = 0
    for (const r of matrix) if (r.length > cols) cols = r.length
    cols = maxCols > 0 ? Math.min(cols, maxCols) : cols
    if (rows <= 0 || cols <= 0) return false
    const grid = matrix.slice(0, rows).map((r) => {
      const row = r.slice(0, cols)
      while (row.length < cols) row.push(null)
      return row
    })
    ;(sheet.getRange(0, 0, rows, cols) as { setValues: (m: unknown) => void }).setValues(grid)
    for (const m of merges) {
      if (m.startRow >= rows || m.startColumn >= cols) continue
      const er = Math.min(m.endRow, rows - 1)
      const ec = Math.min(m.endColumn, cols - 1)
      if (er <= m.startRow && ec <= m.startColumn) continue
      try {
        ;(sheet.getRange(m.startRow, m.startColumn, er - m.startRow + 1, ec - m.startColumn + 1) as {
          merge?: () => void
        }).merge?.()
      } catch {
        // ignore a merge that conflicts with an existing one
      }
    }
    return true
  }

  /** Register the handler invoked when a comment marker (corner badge) is clicked. */
  setCommentMarkerClickHandler(cb: ((row: number, col: number, sheetId: string) => void) | null): void {
    this.commentMarkerClick = cb
  }

  /** Register the handler invoked when the right-click "评论" menu item is chosen. */
  setCommentMenuHandler(cb: (() => void) | null): void {
    this.commentMenuClick = cb
  }

  canEdit(): boolean {
    return canEdit(this.currentRole)
  }

  /**
   * Insert a math formula as a float-DOM drawing at a default spot on the active sheet (draggable).
   * It renders via the registered MathLive component and persists as a DRAWING_DOM drawing (which
   * the drawing Yjs sync replicates). Returns the new drawing id, or null if unavailable.
   */
  insertFormula(latex = '', fontSize = 20): string | null {
    const ws = this.univerAPI.getActiveWorkbook()?.getActiveSheet() as unknown as {
      addFloatDomToPosition?: (
        layer: {
          componentKey: string
          initPosition: { startX: number; endX: number; startY: number; endY: number }
          data?: Record<string, unknown>
          allowTransform?: boolean
        },
        id?: string,
      ) => { id: string } | null
    } | null
    if (!ws?.addFloatDomToPosition) return null
    const id = `formula-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    try {
      const res = ws.addFloatDomToPosition(
        {
          componentKey: OCTO_MATH_FORMULA_KEY,
          initPosition: { startX: 100, endX: 240, startY: 80, endY: 124 },
          data: { latex, id, fontSize },
          allowTransform: true,
        },
        id,
      )
      return res?.id ?? id
    } catch {
      return null
    }
  }

  /**
   * Drop a float-DOM @-mention chip on a cell. Uses the SAME persisted path as formulas
   * (addFloatDomToPosition writes to the drawing model → replicated + restored by binding.ts;
   * addFloatDomToRange is a transient overlay that does NOT persist → "vanishes on reopen").
   * Rendered by our own MentionChip React component: blue @label, @user inert, @doc opens the doc.
   */
  insertMentionChip(
    item: MentionItem,
    cell?: { row: number; col: number },
    ctx?: { mode: 'inline' | 'button'; query: string },
  ): string | null {
    // Final write-gate on the LIVE role. Covers the inline `@` trigger too (not just the ribbon):
    // a reader — or a writer downgraded mid-session — must never persist a chip here, or the Yjs
    // binding declines to sync it and it becomes a misleading local-only phantom. (Mirrors
    // openMentionMenu/pickMention; this is the single sink both the overlay and inline paths reach.)
    if (!canEdit(this.currentRole)) return null
    const ws = this.univerAPI.getActiveWorkbook()?.getActiveSheet() as unknown as {
      addFloatDomToPosition?: (
        layer: {
          componentKey: string
          initPosition: { startX: number; endX: number; startY: number; endY: number }
          data?: Record<string, unknown>
          allowTransform?: boolean
        },
        id?: string,
      ) => { id: string } | null
      getColumnWidth?: (c: number) => number
      getRowHeight?: (r: number) => number
      getRange?: (
        r: number,
        c: number,
      ) => {
        setValue?: (v: unknown) => void
        activate?: () => void
        getValue?: () => unknown
      } | null
      refresh?: () => void
      getSelection?: () => { getActiveRange?: () => { getRow?: () => number; getColumn?: () => number } | null } | null
    } | null
    if (!ws?.addFloatDomToPosition) return null

    const row = cell?.row ?? ws.getSelection?.()?.getActiveRange?.()?.getRow?.() ?? 0
    const col = cell?.col ?? ws.getSelection?.()?.getActiveRange?.()?.getColumn?.() ?? 0

    // Box sized to fit the full "@label" — CJK glyphs ~full-width, latin ~half at the chip's 14px.
    const label = `@${item.label || item.id}`
    let w = 0
    for (const ch of label) w += ch.charCodeAt(0) > 0xff ? 15 : 8
    w = Math.max(52, Math.min(400, w + 18))
    const h = 20

    // Anchor at the target cell's top-left in scene coords (header offset + accumulated col/row
    // sizes) — the SAME persisted float-DOM path formulas use.
    let startX = OCTO_MENTION_ROW_HEADER_W
    let startY = OCTO_MENTION_COL_HEADER_H
    try {
      if (typeof ws.getColumnWidth === 'function' && typeof ws.getRowHeight === 'function') {
        for (let c = 0; c < col; c++) startX += ws.getColumnWidth(c) || 0
        for (let r = 0; r < row; r++) startY += ws.getRowHeight(r) || 0
      }
    } catch {
      startX = 100
      startY = 80
    }
    // Small inset so the chip sits inside the cell (not on its border), vertically centered-ish.
    startX += 2
    startY += 2

    // Unique id for the float-DOM drawing. Prefer crypto.randomUUID (collision-free across
    // replicated clients); fall back to time+random where it's unavailable (old webviews).
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `mention-${crypto.randomUUID()}`
        : `mention-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    let chipId: string
    try {
      const res = ws.addFloatDomToPosition(
        {
          componentKey: OCTO_MENTION_CHIP_KEY,
          initPosition: { startX, endX: startX + w, startY, endY: startY + h },
          data: { id: item.id, label: item.label, type: item.type },
          allowTransform: true,
        },
        id,
      )
      chipId = res?.id ?? id
    } catch {
      // Insertion failed — return WITHOUT touching cell content. (Previously the cell was cleared
      // before this call, so a failure here permanently destroyed the cell's data.)
      return null
    }

    // Chip is in — now reconcile the cell's text. Only after a confirmed insert, so a failed insert
    // can never lose data.
    //  • inline mode: the user typed `@query` into the cell → strip ONLY that trailing `@query`,
    //    preserving any prefix (e.g. `owner: @ali` → `owner: `).
    //  • button mode: the ribbon opened the picker on an existing cell → DO NOT touch its content
    //    (the chip is an overlay; nulling the cell here erased pre-existing text/numbers/formulas).
    if (ctx?.mode === 'inline') {
      try {
        const rng = ws.getRange?.(row, col)
        const raw = rng?.getValue?.()
        const text = typeof raw === 'string' ? raw : raw == null ? '' : String(raw)
        // Strip ONLY the trailing `@query` the popup mirrored. `undefined` means the needle wasn't
        // found (query/cell desync — IME, paste, concurrent edit) → leave the cell untouched rather
        // than erasing it. See stripTrailingQuery for the data-loss rationale.
        const next = stripTrailingQuery(text, ctx.query)
        if (next !== undefined) rng?.setValue?.({ v: next })
      } catch {
        /* best-effort: leave cell as-is rather than risk clobbering it */
      }
    }

    // Nudge a repaint so a freshly-added chip shows immediately (the float-DOM layer otherwise
    // waits for the next selection/scroll).
    try {
      ws.getRange?.(row, col)?.activate?.()
      ws.refresh?.()
    } catch {
      /* best-effort repaint nudge */
    }
    return chipId
  }

  /**
   * Persist an inline formula edit (LaTeX + font size) by patching the DRAWING_DOM record's `data`
   * via SetSheetDrawingCommand, which fires the drawing mutation the Yjs sync observes — so the edit
   * persists + replicates. Assumes the formula is on the active sheet. Best-effort (silent no-op if
   * the drawing/services aren't resolvable).
   */
  updateFormula(id: string, latex: string, fontSize: number): void {
    const ctx = this.resolveDrawing(id)
    if (!ctx) return
    try {
      const updated = { ...ctx.drawing, data: { ...(ctx.drawing.data ?? {}), latex, id, fontSize } }
      this.commandService!.executeCommand('sheet.command.set-sheet-image', { unitId: ctx.unitId, drawings: [updated] })
    } catch {
      // ignore — edit persistence is best-effort
    }
  }

  /**
   * Resolve a formula drawing on the active sheet plus the ids needed to command it. Shared by the
   * inline-edit / resize / style / delete handlers so they all patch the SAME DRAWING_DOM record the
   * Yjs sync replicates. Returns null (silent no-op) if the drawing or the Univer services aren't
   * resolvable.
   */
  private resolveDrawing(id: string): {
    unitId: string
    subUnitId: string
    drawing: { data?: Record<string, unknown>; transform?: Record<string, unknown>; drawingType?: number }
  } | null {
    const wb = this.univerAPI.getActiveWorkbook() as unknown as {
      getId?: () => string
      getActiveSheet: () => { getSheetId?: () => string } | null
    } | null
    const unitId = wb?.getId?.()
    const subUnitId = wb?.getActiveSheet()?.getSheetId?.()
    if (!id || !unitId || !subUnitId || !this.sheetDrawingSvc || !this.commandService) return null
    try {
      const drawing = this.sheetDrawingSvc.getDrawingByParam({ unitId, subUnitId, drawingId: id })
      if (!drawing) return null
      return { unitId, subUnitId, drawing }
    } catch {
      return null
    }
  }

  /**
   * Auto-fit: resize a formula's drawing box to hug its rendered content. Patches the drawing's
   * transform width/height via SetSheetDrawingCommand (the same mutation the Yjs sync observes), so
   * the new size persists + replicates. Best-effort.
   */
  resizeFormula(id: string, w: number, h: number): void {
    const ctx = this.resolveDrawing(id)
    if (!ctx || !(w > 0) || !(h > 0)) return
    try {
      const updated = { ...ctx.drawing, transform: { ...(ctx.drawing.transform ?? {}), width: w, height: h } }
      this.commandService!.executeCommand('sheet.command.set-sheet-image', { unitId: ctx.unitId, drawings: [updated] })
    } catch {
      // ignore — resize is best-effort
    }
  }

  /**
   * Merge a style patch (e.g. `{ color }`) into a formula's drawing `data` via SetSheetDrawingCommand
   * so the style persists + replicates (otherwise a colour pick is only local component state and is
   * lost on reopen / for collaborators). Best-effort.
   */
  styleFormula(id: string, patch: Record<string, unknown>): void {
    const ctx = this.resolveDrawing(id)
    if (!ctx || !patch) return
    try {
      const updated = { ...ctx.drawing, data: { ...(ctx.drawing.data ?? {}), ...patch, id } }
      this.commandService!.executeCommand('sheet.command.set-sheet-image', { unitId: ctx.unitId, drawings: [updated] })
    } catch {
      // ignore — style persistence is best-effort
    }
  }

  /**
   * Delete a formula drawing from the sheet via RemoveSheetDrawingCommand, which fires the drawing
   * mutation the Yjs sync observes — so the removal persists + replicates. Best-effort.
   */
  deleteFormula(id: string): void {
    const ctx = this.resolveDrawing(id)
    if (!ctx) return
    try {
      this.commandService!.executeCommand('sheet.command.remove-sheet-image', {
        unitId: ctx.unitId,
        drawings: [{ unitId: ctx.unitId, subUnitId: ctx.subUnitId, drawingId: id, drawingType: ctx.drawing.drawingType }],
      })
    } catch {
      // ignore — delete is best-effort
    }
  }

  private async clearCache(): Promise<void> {
    // Mirror CollabEditor's terminal teardown (offline/cache.ts §6.3): disconnecting +
    // destroying the y-indexeddb handle only CLOSES the connection — the on-disk data
    // survives and would replay on next open. We must deleteDatabase to truly clear it
    // (the DB name is exactly the cache key). Destroy the handle first so the delete
    // isn't blocked by an open connection.
    this.provider.disconnect()
    if (this.persistence) await this.persistence.destroy()
    try {
      await deleteDatabaseAwait(this.cacheKeyStr)
    } catch {
      // Best-effort: a failed delete must not wedge the terminal close path.
    }
  }

  /** Strict teardown — mirror of CollabEditor.destroyAll(). */
  destroyAll(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.sealTimer) clearTimeout(this.sealTimer)
    this.cursors?.dispose()
    this.commentMarkers?.dispose()
    this.cellMention?.dispose()
    setFormulaSaveHandler(null)
    setFormulaResizeHandler(null)
    setFormulaStyleHandler(null)
    setFormulaDeleteHandler(null)
    setDrawingBlurHandler(null)
    this.binding.dispose()
    this.univer.dispose()
    // Clear our presence BEFORE tearing down the provider so peers don't keep seeing a
    // stale avatar / cursor for a disconnected client (otherwise the last-advertised cell
    // lingers as a ghost box until the awareness timeout).
    this.provider.awareness?.setLocalState(null)
    this.provider.destroy()
    void this.persistence?.destroy()
    this.ydoc.destroy()
    disposeToken(this.documentName)
  }
}
