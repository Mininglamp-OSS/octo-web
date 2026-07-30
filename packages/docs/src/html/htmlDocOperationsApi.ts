// octo-doc AI-operation data layer (undo of an AI element_replace).
//
// SEPARATE BACKEND: like htmlDocComments / htmlGrantsApi, operations for an html doc live in
// octo-doc (the deployment that serves the published HTML), NOT the same-origin `/api/v1` docs
// backend. Every call is a raw credentialed `fetch` against resolveOctoDocBase() carrying the
// octo `token` header. This must never route through the octoweb apiClient.
//
// Synchronized WRITE contract (octo-docs-html):
//   POST /v1/docs/{slug}/operations/{operationId}/undo
//   body: { expected_current_version: <positive int> }
//   permission: Edit (requireDocEdit)
//   200  → PublishResult of the NEW version that restores base HTML (never deletes history).
//   409 version_conflict — a later version landed; the caller must re-diff, we never overwrite.
//   409 already_undone   — idempotent: the operation was already reverted.
// See octo-docs-html internal/service/doc.go::UndoAIChange + handlers_operations.go.

import { resolveOctoDocBase } from './htmlDocFrameHelpers.ts'
import { getWKApp } from '../octoweb/index.ts'

function opsHeaders(base: Record<string, string>): Record<string, string> {
  const tok = getWKApp().loginInfo?.token
  return tok ? { ...base, token: tok } : base
}

function undoUrl(slug: string, operationId: string): string {
  return `${resolveOctoDocBase()}/v1/docs/${encodeURIComponent(slug)}/operations/${encodeURIComponent(operationId)}/undo`
}

/** Result of an AI element_replace, as the client needs it to offer + gate an undo.
 *  operationId identifies the change; the undo is only eligible while the doc's current latest
 *  === newVersion (the backend re-checks with 409 version_conflict, so this is a UX gate only). */
export interface AIChangeResult {
  operationId: string
  baseVersion: number
  newVersion: number
  targetAid?: string
}

/** Stable, typed outcomes the caller distinguishes so the UI can message correctly:
 *  - version_conflict: a later change landed → "已有后续修改，不能直接撤销；请查看版本差异".
 *  - already_undone:   the operation was already reverted (idempotent). */
export class UndoVersionConflictError extends Error {
  constructor() {
    super('version_conflict')
    this.name = 'UndoVersionConflictError'
  }
}
export class UndoAlreadyUndoneError extends Error {
  constructor() {
    super('already_undone')
    this.name = 'UndoAlreadyUndoneError'
  }
}

/** Raw octo-doc PublishResult subset returned by the undo endpoint (snake_case wire shape). */
interface UndoResponse {
  new_version?: number
  base_version?: number
  version?: number
  target_aid?: string
  operation_id?: string
  reverts_operation_id?: string
}

/**
 * Undo the AI element_replace identified by operationId, publishing a NEW version that restores
 * the operation's base HTML (history is preserved). `expectedCurrentVersion` MUST be the version
 * the client currently believes is latest — the backend rejects with 409 version_conflict when a
 * later change landed, so the client can never silently clobber subsequent edits. Edit-gated.
 *
 * Maps the backend's 409 `version_conflict` / `already_undone` codes to distinct typed errors so
 * the UI can show the conflict-vs-idempotent message; any other failure rethrows.
 */
export async function undoAIChange(
  slug: string,
  operationId: string,
  expectedCurrentVersion: number,
): Promise<AIChangeResult> {
  const res = await fetch(undoUrl(slug, operationId), {
    method: 'POST',
    credentials: 'include',
    headers: opsHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
    body: JSON.stringify({ expected_current_version: expectedCurrentVersion }),
  })
  if (!res.ok) {
    if (res.status === 409) {
      // Disambiguate the two 409s by the backend's stable error code.
      const code = await res
        .json()
        .then((d: { error?: string; code?: string } | null) => d?.code ?? d?.error ?? '')
        .catch(() => '')
      if (code === 'already_undone') throw new UndoAlreadyUndoneError()
      throw new UndoVersionConflictError()
    }
    throw new Error(`octo-doc undoAIChange failed: ${res.status}`)
  }
  const data = (await res.json().catch(() => null)) as { data?: UndoResponse } | UndoResponse | null
  const body = (data as { data?: UndoResponse } | null)?.data ?? (data as UndoResponse | null) ?? {}
  return {
    operationId,
    baseVersion: typeof body.base_version === 'number' ? body.base_version : expectedCurrentVersion,
    // The undo publishes a new version; prefer new_version, fall back to the generic version field.
    newVersion: typeof body.new_version === 'number' ? body.new_version : (body.version ?? 0),
    targetAid: body.target_aid,
  }
}
