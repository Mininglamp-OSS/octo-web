import { getWKApp, t } from '../octoweb/index.ts'
import { EditorShell } from '../editor/EditorShell.tsx'
import { DEFAULT_DOC_SPACE, DEFAULT_DOC_FOLDER, DEFAULT_DOC_ID } from '../config.ts'

/**
 * Resolve which document `/docs` should open.
 *
 * The docs-backend currently exposes only per-doc endpoints (`/docs/:docId/...`) — there is
 * no list/create endpoint — so this route cannot enumerate documents. Instead it opens a
 * SPECIFIC document addressed by the URL query, falling back to the deployment-configured
 * defaults (config.ts). Addressing: `/docs?space=<space>&folder=<folder>&doc=<docId>`.
 *
 * Previously DocsHome hardcoded `doc='d_welcome'`, a document that exists in no DB → the
 * editor sat forever on "Loading document…" (collab-token → not_found) and never mounted.
 */
export function resolveDocTarget(search: string): {
  space: string
  folder: string
  doc: string
  docId: string
} | null {
  let space = DEFAULT_DOC_SPACE
  let folder = DEFAULT_DOC_FOLDER
  let doc = DEFAULT_DOC_ID
  try {
    const q = new URLSearchParams(search)
    space = q.get('space') || space
    folder = q.get('folder') || folder
    // `doc` and `docId` are the same identifier (docId is the bare-relative REST key,
    // doc is segment 4 of the documentName); accept either query key.
    doc = q.get('doc') || q.get('docId') || doc
  } catch {
    // Non-browser / malformed search — fall back to configured defaults.
  }
  if (!doc) return null
  return { space, folder, doc, docId: doc }
}

/**
 * Docs landing route (`/docs`). uid/identity come from WKApp.loginInfo (octo session).
 * The editor's awareness frame is built from `user.id` (= the collab-token uid) and a
 * palette colour derived via colorFromId in extensions.ts (6-hex), so it satisfies the
 * backend's validateAwarenessStates check — remote carets work once mounted.
 */
export function DocsHome() {
  const wk = getWKApp()
  const uid = wk.loginInfo.uid
  const target = resolveDocTarget(
    typeof window !== 'undefined' ? window.location.search : '',
  )

  // No document addressed and no configured default: show a clear empty state instead of
  // mounting an editor against a non-existent doc (which would hang on "Loading document…").
  if (!target) {
    return (
      <div className="octo-doc octo-empty">
        <p>{t('docs.state.empty')}</p>
      </div>
    )
  }

  return (
    <EditorShell
      docId={target.docId}
      title={t('docs.state.untitled')}
      uid={uid}
      space={target.space}
      folder={target.folder}
      doc={target.doc}
      user={{ id: uid, name: uid }}
    />
  )
}
