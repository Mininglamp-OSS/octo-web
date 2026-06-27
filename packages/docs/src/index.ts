// Public surface of the `@octo/docs` package (frontend-design §11.2).
//
// In real octo-web, apps/web/src/index.tsx does:
//   import { DocsModule } from '@octo/docs'
//   WKApp.shared.registerModule(new DocsModule())

export { DocsModule } from './module.tsx'
export { EditorShell } from './editor/EditorShell.tsx'
export { StandaloneDocPage, parseStandaloneDocId, isStandaloneDocPath, persistStandaloneReturn, consumeStandaloneReturn, withReturnSid } from './pages/StandaloneDocPage.tsx'
export { BoardShell } from './board/BoardShell.tsx'
export { buildDocumentName, parseDocumentName } from './documentName/index.ts'
export { COLLAB_FIELD, SCHEMA_VERSION } from './schema/index.ts'
export type { Role } from './auth/roles.ts'
export { canEdit, canManage } from './auth/roles.ts'
export { setWKApp } from './octoweb/index.ts'
export type { WKAppShape, IModule } from './octoweb/types.ts'
