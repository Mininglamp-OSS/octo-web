// Whiteboard v1 M2 collaborative binding — public surface.
//
// Forked y-excalidraw binding base (per-field Y.Map storage + per-element CAS + anti-loop guards)
// plus the merge-time repair pass driven by the shared `@octo/whiteboard-schema` rule set. Elements
// are stored field-by-field, but concurrent same-element edits arbitrate by whole-element CAS
// (version/versionNonce), i.e. last-writer-wins per element — NOT lossless field-level merge (see
// binding.ts / yElement.ts for the exact behaviour). The host (BoardShell) constructs an
// `ExcalidrawYjsBinding` against a Y.Doc, wires `handleLocalChange` from Excalidraw's onChange, and
// passes the imperative API in via `setApi`. See ./connect.ts.

export { ExcalidrawYjsBinding, LOCAL_ORIGIN, REPAIR_ORIGIN } from './binding.ts'
export type {
  WhiteboardBindingOptions,
  RenderAdapter,
  FileSync,
  FileUploader,
  FileFetcher,
  FileFetchRef,
} from './binding.ts'
export {
  hashBytesToId,
  makeGenerateIdForFile,
  dataURLToBlob,
  blobToDataURL,
} from './fileSync.ts'
export type { FileLike } from './fileSync.ts'
export { createWhiteboardSession } from './connect.ts'
export type { WhiteboardSession, WhiteboardSessionOptions, BoardTerminal } from './connect.ts'
export { shouldOverwrite, reconcileElement, elementSupersedes } from './reconcile.ts'
export type { VersionStamp } from './reconcile.ts'
export { repairForRender } from './repair.ts'
export {
  ELEMENTS_FIELD,
  FILES_FIELD,
  WB_SCHEMA_VERSION,
  WB_ELEMENT_TYPES,
  normalizeElement,
  buildFileRef,
  normalizeFileRef,
  isUsableFileRef,
  FILE_REF_STATUS,
  buildWhiteboardName,
  parseWhiteboardName,
  SCHEMA_PACKAGE_WIRED,
} from './schema.ts'
export type { WhiteboardElement, FileRef, FileRefStatus, NormalizeContext } from './schema.ts'
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
