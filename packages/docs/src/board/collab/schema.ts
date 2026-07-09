// Frozen shared schema — now wired to the real `@octo/whiteboard-schema` (XIN-16 §3, XIN-26).
//
// This module was the seam that isolated the one package-gated dependency. The package has
// shipped (vendored verbatim from boris-clark/octo-whiteboard-schema@v0.2.0 as the workspace
// package `@octo/whiteboard-schema`), so the seam now simply RE-EXPORTS it. The binding and the
// repair pass import the shared field-name constants, `WB_SCHEMA_VERSION`, the element-type
// whitelist, the `normalizeElement` rule set, the CAS arbiter (`elementSupersedes`) and the
// whiteboard key codec from here — the same definitions the backend authoritative repair and the
// Agent path use, so FE and BE never normalise to different shapes (XIN-16 §3.2).
//
// The only FE/BE difference is who writes the result back: the backend repair is the single
// authoritative writer (§4); the FE runs `normalizeElement` for local render defence only and
// never writes the repaired result to the Y.Doc.

export {
  ELEMENTS_FIELD,
  FILES_FIELD,
  WB_SCHEMA_VERSION,
  WB_ELEMENT_TYPES,
  FILE_BEARING_TYPES,
  FILE_REF_FIELDS,
  REPAIR_ORIGIN,
  REPAIR_CLIENT_ID,
  normalizeElement,
  buildFileRef,
  normalizeFileRef,
  isUsableFileRef,
  FILE_REF_STATUS,
  elementSupersedes,
  deterministicNonce,
  isValidIndex,
  buildWhiteboardName,
  parseWhiteboardName,
  WhiteboardNameError,
} from '@octo/whiteboard-schema'

export type {
  WhiteboardElement,
  FileRef,
  FileRefStatus,
  NormalizeContext,
  ParsedWhiteboardName,
} from '@octo/whiteboard-schema'

/** True now that the seam is wired to the real shared package (was false while placeholdered). */
export const SCHEMA_PACKAGE_WIRED = true
