// Link share scope REST (feature #64, backend src/api/routes/docs.ts).
//
// Mirrors members/api.ts: all calls go through the shared apiClient with
// BARE-RELATIVE `/docs/...` paths (inherits `/api/v1/` baseURL + token /
// X-Space-Id interceptors); no auth code here. Read is reader-level, write is
// admin-gated by the caller (the panel only renders under canManage).

import { apiClient } from '../octoweb/index.ts'
import {
  normalizeShareRole,
  normalizeShareScope,
  type ShareRole,
  type ShareScope,
  type ShareSettings,
} from './shareScope.ts'

interface ShareWire {
  docId?: string
  shareScope?: unknown
  shareRole?: unknown
}

/**
 * GET /docs/{docId}/share → `{ docId, shareScope, shareRole }`. Any value is
 * coerced through the fail-safe normalizers so an unexpected body never widens
 * access; callers get a fully-populated ShareSettings.
 */
export async function getShareSettings(docId: string): Promise<ShareSettings> {
  const { data } = await apiClient().get<ShareWire>(`/docs/${docId}/share`)
  return {
    shareScope: normalizeShareScope(data?.shareScope),
    shareRole: normalizeShareRole(data?.shareRole),
  }
}

/**
 * PUT /docs/{docId}/share → `{ docId, shareScope, shareRole }`.
 *
 * Contract (byte-aligned with putShareHandler): `anyone_in_space` MUST carry a
 * valid `shareRole` or the backend returns 400 invalid_role, so we always send a
 * role (defaulting to `read`) in that case. `restricted` ignores any role the
 * backend receives (it force-persists `read`), so we omit it. The returned
 * canonical `{ shareScope, shareRole }` is what the UI should settle on.
 */
export async function setShareSettings(
  docId: string,
  scope: ShareScope,
  role?: ShareRole,
): Promise<ShareSettings> {
  const body: { shareScope: ShareScope; shareRole?: ShareRole } = { shareScope: scope }
  if (scope === 'anyone_in_space') body.shareRole = role ?? 'read'
  const { data } = await apiClient().put<ShareWire>(`/docs/${docId}/share`, body)
  return {
    shareScope: normalizeShareScope(data?.shareScope ?? scope),
    shareRole: normalizeShareRole(data?.shareRole ?? body.shareRole ?? 'read'),
  }
}
