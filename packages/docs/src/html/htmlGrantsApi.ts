// octo-doc grants data layer (member management for HTML docs).
//
// SEPARATE BACKEND: like htmlDocComments, grants for an html doc live in octo-doc
// (the deployment that serves the published HTML), NOT the same-origin Yjs
// `/api/v1` docs backend. Every call is a raw credentialed `fetch` against
// resolveOctoDocBase() + `/v1/docs/{slug}/grants`, carrying the octo `token` header so octo-doc
// resolves the caller to the doc's author (only an author may manage grants).
// This must never route through the octoweb apiClient.
//
// Shape mirrors the rich-doc members contract ({uid, role, source, grantedBy}) so
// the shared MemberPanel can consume this backend unchanged. The HTML backend now
// writes into the same rich-doc doc_member table and accepts the four-role vocabulary;
// AddGrant bestows reader|commenter|writer (admin is owned by creator_uid, never mintable
// through /grants). The synthesized creator row is surfaced as an owner/admin row.

import { resolveOctoDocBase } from './htmlDocFrameHelpers.ts'
import { getWKApp } from '../octoweb/index.ts'
import { isRole, type Role } from '../auth/roles.ts'

// octo-doc verifies identity via the `token` header (octo convention, not
// Authorization) — same scheme as the render/comment fetches.
function grantHeaders(base: Record<string, string>): Record<string, string> {
  const tok = getWKApp().loginInfo?.token
  return tok ? { ...base, token: tok } : base
}

// Backend route is /v1/docs/{slug}/grants (+ /{uid} for DELETE). The web nginx now
// forwards the /docs-html prefix through a single strip rewrite, so the frontend
// builds the real backend path directly and carries the token header.
function grantsUrl(slug: string): string {
  return `${resolveOctoDocBase()}/v1/docs/${encodeURIComponent(slug)}/grants`
}

/** One grant row, matching the rich-doc Member shape MemberPanel expects.
 *  `role` is the four-role union; the owner row carries the sentinel string `'author'`
 *  (never a doc_member role) so the panel can render a locked, non-role owner badge. */
export interface HtmlGrant {
  uid: string
  role: Role | 'author'
  source: 'direct' | 'owner'
  grantedBy?: string
}

/** Raw wire row before role validation (backend may send any string). */
interface RawGrant {
  uid: string
  role?: unknown
  source?: 'direct' | 'owner'
  grantedBy?: string
}

interface ListGrantsResponse {
  items: RawGrant[]
}

// Fail closed: an unknown/unexpected role string is coerced to 'reader' (least privilege) rather
// than trusted verbatim, so a stray backend value can never silently widen a member's UI power.
function normalizeGrantRole(v: unknown): Role {
  return isRole(v) ? v : 'reader'
}

/** List a doc's grants (creator synthesized as the leading owner row). Author-only. */
export async function listGrants(slug: string): Promise<HtmlGrant[]> {
  const res = await fetch(grantsUrl(slug), {
    credentials: 'include',
    headers: grantHeaders({ Accept: 'application/json' }),
  })
  if (!res.ok) throw new Error(`octo-doc listGrants failed: ${res.status}`)
  const data = (await res.json()) as { data?: Partial<ListGrantsResponse> } | Partial<ListGrantsResponse> | null
  const items = (data as { data?: ListGrantsResponse } | null)?.data?.items ?? (data as ListGrantsResponse | null)?.items
  return (items ?? []).map((raw) => ({
    uid: raw.uid,
    role: normalizeGrantRole(raw.role),
    source: raw.source ?? 'direct',
    grantedBy: raw.grantedBy,
  }))
}

/** Grant uid a role (upsert). The HTML backend accepts reader|commenter|writer and refuses admin
 *  (admin identity is owned by creator_uid). Author/admin-only. */
export async function addGrant(slug: string, uid: string, role: Role): Promise<void> {
  const res = await fetch(grantsUrl(slug), {
    method: 'PUT',
    credentials: 'include',
    headers: grantHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
    body: JSON.stringify({ uid, role }),
  })
  if (!res.ok) throw new Error(`octo-doc addGrant failed: ${res.status}`)
}

/** Revoke uid's grant. Author-only. The creator cannot be removed (backend 409). */
export async function removeGrant(slug: string, uid: string): Promise<void> {
  const res = await fetch(`${grantsUrl(slug)}/${encodeURIComponent(uid)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: grantHeaders({ Accept: 'application/json' }),
  })
  if (!res.ok) throw new Error(`octo-doc removeGrant failed: ${res.status}`)
}
