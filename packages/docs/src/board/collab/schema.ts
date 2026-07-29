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

// ── canvas-level appState (PR #1161) ────────────────────────────────────────────────────────────
//
// Beyond `elements` and `files`, the live whiteboard has a small amount of scene-level state that is
// NOT a per-element property but must still converge across peers — today just the canvas background
// colour. Rather than smuggle it into a synthetic element, it lives in its own flat top-level `Y.Map`
// (a single scalar write per explicit user change). These names are FE-owned because the frozen shared
// schema and current backend version serializer do not yet model this container. Version capture is
// therefore intentionally out of scope here; a future backend change must adopt these exact names
// before the version preview path is added.

/** Top-level Y.Map container for live scene-level appState (currently canvas background only). */
export const APPSTATE_FIELD = 'appState'

/** Key under {@link APPSTATE_FIELD} holding the authoritative canvas background colour — a CSS colour
 *  string mirroring Excalidraw's `appState.viewBackgroundColor` (e.g. `#ffffff`). */
export const VIEW_BACKGROUND_COLOR_KEY = 'viewBackgroundColor'

/** Excalidraw's own default canvas background. The single source of truth for the colour a cleared /
 *  absent {@link VIEW_BACKGROUND_COLOR_KEY} repaints to and the picker's reset target, so the binding
 *  and {@link BoardCanvasColorControl} can never disagree on what "no explicit background" means. */
export const DEFAULT_VIEW_BACKGROUND_COLOR = '#ffffff'
