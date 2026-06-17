// Canonical golden wire payloads for the version-history endpoints.
//
// These are the SHARED fixtures both the frontend contract test and (by mirror)
// the backend contract test assert against. They use the exact canonical field
// names from contract.ts. Tests drive the real api.ts functions through the mock
// transport with these payloads as responder data — they must NEVER hand-build a
// wire shape inline, otherwise drift creeps back in.
//
// See contract.ts for authority (version-history-design-draft-v0.4 §7).

import type {
  WireCreateVersionResponse,
  WireListVersionsResponse,
  WireRestoreResponse,
  WireVersionRow,
} from './contract.ts'

/** One named version row. */
export const FIXTURE_NAMED_ROW: WireVersionRow = {
  docVersionSeq: 7,
  kind: 2, // named
  label: 'milestone v1',
  createdBy: 'u_1',
  createdAt: '2026-06-01T10:00:00Z',
  sizeBytes: 100,
  schemaVersion: 4,
  restoredFrom: null,
}

/** One autosave row (empty label, kind=auto). */
export const FIXTURE_AUTO_ROW: WireVersionRow = {
  docVersionSeq: 6,
  kind: 1, // auto
  label: '',
  createdBy: 'u_2',
  createdAt: '2026-06-01T09:00:00Z',
  sizeBytes: 90,
  schemaVersion: 4,
  restoredFrom: null,
}

/** One restore-marker row (kind=restore-marker, restoredFrom set). */
export const FIXTURE_RESTORE_MARKER_ROW: WireVersionRow = {
  docVersionSeq: 5,
  kind: 3, // restore-marker
  label: 'restored from #2',
  createdBy: 'u_1',
  createdAt: '2026-06-01T08:00:00Z',
  sizeBytes: 80,
  schemaVersion: 4,
  restoredFrom: 2,
}

/** GET list response — one page with a follow-on cursor. */
export const FIXTURE_LIST_RESPONSE: WireListVersionsResponse = {
  items: [FIXTURE_NAMED_ROW, FIXTURE_AUTO_ROW, FIXTURE_RESTORE_MARKER_ROW],
  nextCursor: 5,
}

/** GET list response — final page (history exhausted). */
export const FIXTURE_LIST_RESPONSE_LAST: WireListVersionsResponse = {
  items: [],
  nextCursor: null,
}

/** POST create response. */
export const FIXTURE_CREATE_RESPONSE: WireCreateVersionResponse = {
  docVersionSeq: 42,
}

/** POST restore response. */
export const FIXTURE_RESTORE_RESPONSE: WireRestoreResponse = {
  newDocVersionSeq: 50,
  restoredFrom: 7,
}

/**
 * A DRIFTED list payload using the pre-canonical backend names (`id`/`name`
 * instead of `docVersionSeq`/`label`). Used only by the drift-guard test to
 * prove the contract test detects a non-canonical backend. Typed as unknown so
 * it cannot accidentally satisfy a canonical interface.
 */
export const FIXTURE_DRIFTED_LIST_RESPONSE: unknown = {
  items: [
    {
      id: 7,
      kind: 2,
      name: 'milestone v1',
      createdBy: 'u_1',
      createdAt: '2026-06-01T10:00:00Z',
      sizeBytes: 100,
      schemaVersion: 4,
      restoredFromVersionId: null,
    },
  ],
  nextCursor: 5,
}

/**
 * A DRIFTED restore payload using the pre-canonical backend names
 * (`safetyVersionId`/`restoredFromVersionId`). Used only by the drift-guard test.
 */
export const FIXTURE_DRIFTED_RESTORE_RESPONSE: unknown = {
  safetyVersionId: 50,
  restoredFromVersionId: 7,
}
