// octo-doc grants data layer (member management for HTML docs).
//
// SEPARATE BACKEND: like htmlDocComments, grants for an html doc live in octo-doc
// (the deployment that serves the published HTML), NOT the same-origin Yjs
// `/api/v1` docs backend. Every call is a raw credentialed `fetch` against
// resolveOctoDocBase() + `/grants`, carrying the octo `token` header so octo-doc
// resolves the caller to the doc's author (only an author may manage grants).
// This must never route through the octoweb apiClient.
//
// Shape mirrors the rich-doc members contract ({uid, role, source, grantedBy}) so
// the shared MemberPanel can consume this backend unchanged. Only the reader role
// is supported today (author is the synthesized creator row).

import { resolveOctoDocBase } from './HtmlDocView.tsx'
import { getWKApp } from '../octoweb/index.ts'

// octo-doc verifies identity via the `token` header (octo convention, not
// Authorization) — same scheme as the render/comment fetches.
function grantHeaders(base: Record<string, string>): Record<string, string> {
  const tok = getWKApp().loginInfo?.token
  return tok ? { ...base, token: tok } : base
}

// Backend route is /v1/docs/{slug}/grants (+ /{uid} for DELETE). The web nginx
// exposes it under a dedicated top-level /grants/{slug} prefix (NOT /docs/... —
// that collides with the SPA's own /docs route) and rewrites it to the doc's
// /v1/docs/{slug}/grants, forwarding the token header — same scheme as /comments.
function grantsUrl(slug: string): string {
  return `${resolveOctoDocBase()}/grants/${encodeURIComponent(slug)}`
}

/** One grant row, matching the rich-doc Member shape MemberPanel expects. */
export interface HtmlGrant {
  uid: string
  role: string
  source: 'direct' | 'owner'
  grantedBy?: string
}

interface ListGrantsResponse {
  items: HtmlGrant[]
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
  return items ?? []
}

/** Grant uid reader access (upsert). Author-only. */
export async function addGrant(slug: string, uid: string, role: string): Promise<void> {
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
