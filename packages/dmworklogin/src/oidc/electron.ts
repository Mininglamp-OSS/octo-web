import type { OidcHttpClient } from './api'
import { createFetchHttpClient, fetchHttpClient, OidcBindHttpError } from './http'

interface OidcIpcHttpResponse {
  __octoOidcHttpResponse: true
  ok: boolean
  status: number
  body?: unknown
}

function isOidcIpcHttpResponse(value: unknown): value is OidcIpcHttpResponse {
  return !!value && typeof value === 'object' &&
    (value as Record<string, unknown>).__octoOidcHttpResponse === true &&
    typeof (value as Record<string, unknown>).ok === 'boolean' &&
    typeof (value as Record<string, unknown>).status === 'number'
}

function errorMessage(body: unknown): string | undefined {
  if (typeof body === 'string' && body !== '') return body
  if (body && typeof body === 'object') {
    const msg = (body as Record<string, unknown>).msg
    if (typeof msg === 'string' && msg !== '') return msg
  }
  return undefined
}

async function invokeOidcHttp<T>(
  ipc: { invoke(channel: string, request: unknown): Promise<unknown> },
  request: unknown,
): Promise<T> {
  const result = await ipc.invoke(IPC_OIDC_HTTP_REQUEST, request)
  // Accept the old raw-body shape for compatibility with older preload/main
  // pairs during staged desktop upgrades.
  if (!isOidcIpcHttpResponse(result)) return result as T
  if (!result.ok) throw new OidcBindHttpError(result.status, errorMessage(result.body))
  return result.body as T
}

/**
 * IPC channel name for renderer→main "prepare OIDC authorize" handshake.
 *
 * MUST stay in sync with `apps/web/src-election/shared/ipc-channels.ts`
 * (`IPC_OIDC_AUTHORIZE_START`). It lives here as a local constant because
 * `@octo/login` is an Electron-agnostic package and cannot depend on
 * `apps/web/src-election`. If you change either side, update both.
 */
export const IPC_OIDC_AUTHORIZE_START = 'oidc-authorize-start'
export const IPC_OIDC_AUTHORIZE_END = 'oidc-authorize-end'
export const IPC_OIDC_API_ORIGIN_START = 'oidc-api-origin-start'
export const IPC_OIDC_HTTP_REQUEST = 'oidc-http-request'

export interface OidcAuthorizeStartResult {
  ok: boolean
  // `untrusted-sender` is returned when the main process rejects the calling
  // frame — packaged builds gate this on file:// top-frame, dev builds on the
  // `--octo-dev-origin=` value. Renderers still collapse all failure modes to
  // one user-facing "oidc.failed" toast; the distinct code is for diagnostics.
  code?: 'no-window' | 'invalid-origin' | 'invalid-flow' | 'untrusted-sender'
}

/**
 * True when the renderer is running inside the Electron packaged shell.
 * `file://` is what `loadFile(build/index.html)` produces; the dev-server
 * origin does NOT count as desktop — dev flows still hit a real HTTP origin
 * so relative URLs resolve correctly without the IPC bridge.
 */
export function isElectronDesktop(): boolean {
  return typeof window !== 'undefined' && window.location.protocol === 'file:'
}

export async function beginOidcAuthorize(
  apiURL: string,
  authcode: string,
  providerId: string,
): Promise<OidcAuthorizeStartResult> {
  const ipc = typeof window !== 'undefined' ? (window as any).ipc : undefined
  if (typeof ipc?.invoke !== 'function') return { ok: false, code: 'no-window' }
  return ipc.invoke(IPC_OIDC_AUTHORIZE_START, apiURL, authcode, providerId) as Promise<OidcAuthorizeStartResult>
}

export async function registerOidcApiOrigin(apiURL: string): Promise<boolean> {
  const ipc = typeof window !== 'undefined' ? (window as any).ipc : undefined
  if (typeof ipc?.invoke !== 'function') return false
  const result = await ipc.invoke(IPC_OIDC_API_ORIGIN_START, apiURL) as { ok?: boolean }
  return result?.ok === true
}

export async function endOidcAuthorize(): Promise<void> {
  const ipc = typeof window !== 'undefined' ? (window as any).ipc : undefined
  if (typeof ipc?.invoke !== 'function') return
  try { await ipc.invoke(IPC_OIDC_AUTHORIZE_END) } catch { /* best effort cleanup */ }
}

/**
 * Pick the OIDC HTTP client for the current runtime:
 *   - Electron packaged shell (file://): must resolve relative `/v1/...`
 *     paths against the API origin, otherwise fetch would target file://.
 *   - Web / dev-server: reuse the default apiClient-relative client.
 *
 * `apiURL` empty AND desktop is a misconfiguration — callers should treat it
 * as fatal (relative fetch under file:// will 100% fail); we still return the
 * default client so the caller can decide how to surface the error.
 */
export function getOidcClient(apiURL: string): OidcHttpClient {
  if (isElectronDesktop() && /^https?:\/\//i.test(apiURL)) {
    const ipc = (window as any).ipc
    if (typeof ipc?.invoke === 'function') {
      return {
        async get<T>(url: string): Promise<T> {
          const absoluteURL = new URL(url, apiURL.endsWith('/') ? apiURL : `${apiURL}/`).toString()
          return invokeOidcHttp<T>(ipc, { url: absoluteURL, method: 'GET' })
        },
        async post<T>(url: string, body: unknown): Promise<T> {
          const absoluteURL = new URL(url, apiURL.endsWith('/') ? apiURL : `${apiURL}/`).toString()
          return invokeOidcHttp<T>(ipc, {
            url: absoluteURL,
            method: 'POST',
            body,
          })
        },
      }
    }
    return createFetchHttpClient(apiURL)
  }
  return fetchHttpClient
}
