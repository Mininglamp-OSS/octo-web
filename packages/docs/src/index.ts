// Public surface of the `@octo/docs` package (frontend-design §11.2).
//
// In real octo-web, apps/web/src/index.tsx does:
//   import { DocsModule } from '@octo/docs'
//   WKApp.shared.registerModule(new DocsModule())

export { DocsModule } from './module.tsx'
export { EditorShell } from './editor/EditorShell.tsx'
export { StandaloneDocPage, parseStandaloneDocId, isStandaloneDocPath, persistStandaloneReturn, consumeStandaloneReturn, withReturnSid } from './pages/StandaloneDocPage.tsx'
export { BoardShell } from './board/BoardShell.tsx'
// html_ppt peer surfaces (R3-F1, XIN-1495): the editor + present route pages the host Layout mounts,
// and the pure route parsers it intercepts with (mirroring the standalone `/d/:docId` wiring).
export { PptEditorPage } from './ppt/PptEditorPage.tsx'
export { PptPresentPage } from './ppt/PptPresentPage.tsx'
export {
  parsePptEditorDocId,
  isPptEditorPath,
  parsePptPresentDocId,
  isPptPresentPath,
  parsePresentVersion,
} from './ppt/pptRoutes.ts'
export { buildDocumentName, parseDocumentName } from './documentName/index.ts'
export { COLLAB_FIELD, SCHEMA_VERSION } from './schema/index.ts'
export type { Role } from './auth/roles.ts'
export { canEdit, canManage } from './auth/roles.ts'
export { setWKApp } from './octoweb/index.ts'
export type { WKAppShape, IModule } from './octoweb/types.ts'
