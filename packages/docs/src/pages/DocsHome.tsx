import { getWKApp } from '../octoweb/index.ts'
import { EditorShell } from '../editor/EditorShell.tsx'

/**
 * Docs landing route (`/docs`). In production this would list spaces/folders/documents and
 * route into a selected doc; here it mounts a demo document so the editor is runnable
 * standalone. uid/identity come from WKApp.loginInfo (octo session).
 */
export function DocsHome() {
  const wk = getWKApp()
  const uid = wk.loginInfo.uid

  // Demo addressing — segment 3 is the docs-native folder (§7.2).
  const space = 'demo'
  const folder = 'f_default'
  const doc = 'd_welcome'
  const docId = doc

  return (
    <EditorShell
      docId={docId}
      title="Welcome to Octo Docs"
      uid={uid}
      space={space}
      folder={folder}
      doc={doc}
      user={{ id: uid, name: uid }}
    />
  )
}
