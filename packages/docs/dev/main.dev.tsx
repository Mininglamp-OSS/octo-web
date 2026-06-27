import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setWKApp } from '../src/octoweb/index.ts'
import { createMockWKApp } from '../src/octoweb/mock.ts'
import { DocsModule } from '../src/module.tsx'
import { App } from '../src/App.tsx'

// Standalone dev harness for the M1 whiteboard verification.
//
// It boots the docs module against a mock WKApp whose apiClient is backed by a tiny in-memory
// docs store persisted to localStorage. That makes the list/create/get/rename/delete REST
// (backend §8.4) behave like a real backend for the FRONTEND flows we verify here — entry
// dropdown, mixed list, board create/open, `?doc=` addressing — WITHOUT needing the collab
// backend (M1 is standalone; binding is M2). Board *content* persists separately via boardStore
// (localStorage), so a drawn board survives close/reopen and a full refresh.
//
// This harness is dev-only and is never shipped: production wires the module in apps/web against
// the real WKApp + backend.

type Role = 'admin' | 'writer' | 'reader'
interface DocRecord {
  docId: string
  title: string
  ownerId: string
  role: Role
  updatedAt: string
  docType: string
}

const STORE_KEY = 'octo.dev.docs.records'
const UID = 'u_dev'

function loadRecords(): DocRecord[] {
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    const parsed = raw ? (JSON.parse(raw) as DocRecord[]) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
function saveRecords(records: DocRecord[]): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(records))
  } catch {
    /* ignore quota */
  }
}

let seq = 0
function newId(prefix: string): string {
  seq += 1
  // Avoid Date.now()-only ids (collisions across reloads are fine here): combine time + counter.
  return `${prefix}_${Date.now().toString(36)}_${seq}`
}

const wk = createMockWKApp({ uid: UID, token: 'dev-octo-session-token' })

wk.apiClient.responder = (method, rawUrl, body) => {
  const url = rawUrl.split('?')[0]

  // Auth / collateral endpoints the editor touches — keep these BEFORE the `/docs/:id` match.
  if (url === '/docs/collab-token') {
    return {
      data: { token: 'dev-collab-jwt', expiresAt: Date.now() + 5 * 60_000, role: 'admin', permission_epoch: 1 },
      status: 200,
    }
  }
  if (url.endsWith('/members')) return { data: { items: [] }, status: 200 }
  if (url.endsWith('/invites')) return { data: { items: [] }, status: 200 }

  // List / create.
  if (url === '/docs') {
    if (method === 'get') {
      const items = loadRecords()
        .slice()
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      return { data: { total: items.length, items }, status: 200 }
    }
    if (method === 'post') {
      const input = (body || {}) as { title?: string; docType?: string }
      const rec: DocRecord = {
        docId: newId(input.docType === 'board' ? 'b' : 'd'),
        title: input.title || '',
        ownerId: UID,
        role: 'admin', // creator is admin (AC3)
        updatedAt: new Date().toISOString(),
        docType: input.docType || 'doc',
      }
      const records = loadRecords()
      records.push(rec)
      saveRecords(records)
      return { data: { ...rec, documentName: rec.docId, spaceId: 'demo', folderId: 'f_default' }, status: 200 }
    }
  }

  // Per-doc get / rename / delete.
  const m = url.match(/^\/docs\/([^/]+)$/)
  if (m) {
    const id = m[1]
    const records = loadRecords()
    const idx = records.findIndex((r) => r.docId === id)
    if (method === 'get') {
      if (idx < 0) return { data: {}, status: 404 }
      return { data: records[idx], status: 200 }
    }
    if (method === 'patch') {
      if (idx < 0) return { data: {}, status: 404 }
      const title = ((body || {}) as { title?: string }).title
      if (typeof title === 'string') {
        records[idx] = { ...records[idx], title, updatedAt: new Date().toISOString() }
        saveRecords(records)
      }
      return { data: records[idx], status: 200 }
    }
    if (method === 'delete') {
      if (idx >= 0) {
        records.splice(idx, 1)
        saveRecords(records)
      }
      return { data: {}, status: 200 }
    }
  }

  return { data: {}, status: 200 }
}

setWKApp(wk)
wk.shared.registerModule(new DocsModule())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App routes={wk.route.routes} />
  </StrictMode>,
)
