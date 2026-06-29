// Whiteboard v1 M2 collaborative binding — public surface.
//
// Forked y-excalidraw binding base (field-level Y.Map merge + CAS + anti-loop guards) plus the
// merge-time repair pass driven by the shared `@octo/whiteboard-schema` rule set. The host
// (BoardShell) constructs an `ExcalidrawYjsBinding` against a Y.Doc, wires `handleLocalChange`
// from Excalidraw's onChange, and passes the imperative API in via `setApi`. See ./connect.ts.

export { ExcalidrawYjsBinding, LOCAL_ORIGIN, REPAIR_ORIGIN } from './binding.ts'
export type { WhiteboardBindingOptions, RenderAdapter } from './binding.ts'
export { createWhiteboardSession } from './connect.ts'
export type { WhiteboardSession, WhiteboardSessionOptions } from './connect.ts'
export { shouldOverwrite, reconcileElement, elementSupersedes } from './reconcile.ts'
export type { VersionStamp } from './reconcile.ts'
export { repairForRender } from './repair.ts'
export {
  ELEMENTS_FIELD,
  FILES_FIELD,
  WB_SCHEMA_VERSION,
  WB_ELEMENT_TYPES,
  normalizeElement,
  buildWhiteboardName,
  parseWhiteboardName,
  SCHEMA_PACKAGE_WIRED,
} from './schema.ts'
export type { WhiteboardElement, NormalizeContext } from './schema.ts'
export {
  readAllElements,
  readElement,
  upsertElement,
  writeElementFields,
  jsonEqual,
} from './yElement.ts'
export { emptyTelemetry, AwarenessSurface } from './telemetry.ts'
export type { BindingTelemetry, AwarenessState } from './telemetry.ts'
export {
  setLocalPresenceUser,
  publishLocalPointer,
  clearLocalPointer,
  readBoardCollaborators,
  presenceDelta,
} from './presence.ts'
export type { BoardCollaborator, BoardPresenceUser, BoardPointer } from './presence.ts'
export type {
  ExcalidrawElement,
  ExcalidrawBindingAPI,
  BinaryFileData,
  Json,
} from './types.ts'
