import { useEffect, useState, useCallback } from 'react'
import { getWKApp, t } from '../octoweb/index.ts'
import { EditorShell } from '../editor/EditorShell.tsx'
import { DEFAULT_DOC_SPACE, DEFAULT_DOC_FOLDER, DEFAULT_DOC_ID } from '../config.ts'
import { listDocs, createDoc, type DocListItem } from './docsApi.ts'

/**
 * Resolve which document `/docs` should open from the URL query.
 * Addressing: `/docs?space=<space>&folder=<folder>&doc=<docId>`. When no doc is addressed
 * this returns null and DocsHome renders the document list instead (the backend exposes
 * GET/POST /api/v1/docs for list/create).
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
    doc = q.get('doc') || q.get('docId') || doc
  } catch {
    // Non-browser / malformed search — fall back to configured defaults.
  }
  if (!doc) return null
  return { space, folder, doc, docId: doc }
}

/** Build the `/docs` URL that opens a specific document, preserving octo's `sid` param. */
function docHref(docId: string, space: string, folder: string): string {
  const q = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
  q.set('space', space)
  q.set('folder', folder)
  q.set('doc', docId)
  return `/docs?${q.toString()}`
}

/**
 * Document list landing — shown when `/docs` is opened without a specific doc addressed.
 * Lists documents the caller owns or is a member of (GET /api/v1/docs) and offers a
 * "new document" action (POST /api/v1/docs). Selecting/creating navigates to the editor.
 */
function DocsList({ space, folder }: { space: string; folder: string }): React.ReactElement {
  const [items, setItems] = useState<DocListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    listDocs({ spaceId: space || undefined, folderId: folder || undefined, sort: 'updatedAt:desc' })
      .then((res) => setItems(res.items))
      .catch(() => setError(t('docs.state.error')))
      .finally(() => setLoading(false))
  }, [space, folder])

  useEffect(reload, [reload])

  const openDoc = (docId: string) => {
    if (typeof window !== 'undefined') window.location.assign(docHref(docId, space, folder))
  }

  const onCreate = async () => {
    if (creating) return
    setCreating(true)
    try {
      const created = await createDoc({
        title: t('docs.state.untitled'),
        spaceId: space || undefined,
        folderId: folder || undefined,
      })
      openDoc(created.docId)
    } catch {
      setError(t('docs.state.error'))
      setCreating(false)
    }
  }

  return (
    <div className="octo-doc octo-docs-list">
      <div className="octo-docs-list-header">
        <h2>{t('docs.menu.title')}</h2>
        <button type="button" onClick={onCreate} disabled={creating}>
          {t('docs.list.new')}
        </button>
      </div>
      {loading && <p className="octo-docs-list-state">{t('docs.state.loading')}</p>}
      {error && !loading && <p className="octo-docs-list-state octo-error">{error}</p>}
      {!loading && !error && items.length === 0 && (
        <p className="octo-docs-list-state">{t('docs.state.empty')}</p>
      )}
      {!loading && !error && items.length > 0 && (
        <ul className="octo-docs-list-items">
          {items.map((d) => (
            <li key={d.docId}>
              <button type="button" onClick={() => openDoc(d.docId)}>
                {d.title || t('docs.state.untitled')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Docs landing route (`/docs`). uid/identity come from WKApp.loginInfo (octo session).
 * If the URL addresses a specific doc -> open the editor; otherwise render the document
 * list (open existing / create new). The editor's awareness frame is built from user.id
 * (= collab-token uid) + a palette colour via colorFromId (6-hex) in extensions.ts, so it
 * satisfies the backend validateAwarenessStates check — remote carets work once mounted.
 */
export function DocsHome() {
  const wk = getWKApp()
  const uid = wk.loginInfo.uid
  const target = resolveDocTarget(
    typeof window !== 'undefined' ? window.location.search : '',
  )

  if (!target) {
    // No doc addressed: list documents (space comes from the current octo Space, else default).
    const space = wk.shared.currentSpaceId || DEFAULT_DOC_SPACE
    return <DocsList space={space} folder={DEFAULT_DOC_FOLDER} />
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
