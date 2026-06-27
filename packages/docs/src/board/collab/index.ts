// Whiteboard v1 M2 collaborative binding — public surface.
//
// Forked y-excalidraw binding base (field-level Y.Map merge + CAS + anti-loop guards) plus the
// schema seam and the deferred repair pass. The host (BoardShell) constructs an
// `ExcalidrawYjsBinding` against a Y.Doc, wires `handleLocalChange` from Excalidraw's onChange,
// and passes the imperative API in via `setApi`. See ./connect.ts for the provider wiring.

export { ExcalidrawYjsBinding, LOCAL_ORIGIN, REPAIR_ORIGIN } from './binding.ts'
export type { WhiteboardBindingOptions } from './binding.ts'
export { createWhiteboardSession } from './connect.ts'
export type { WhiteboardSession, WhiteboardSessionOptions } from './connect.ts'
export { shouldOverwrite, reconcileElement } from './reconcile.ts'
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
export {
  readAllElements,
  readElement,
  upsertElement,
  writeElementFields,
  jsonEqual,
} from './yElement.ts'
export { emptyTelemetry, AwarenessSurface } from './telemetry.ts'
export type { BindingTelemetry, AwarenessState } from './telemetry.ts'
export type {
  ExcalidrawElement,
  ExcalidrawBindingAPI,
  BinaryFileData,
  Json,
} from './types.ts'
