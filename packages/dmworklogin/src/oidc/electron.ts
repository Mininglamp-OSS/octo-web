import type { OidcHttpClient, OidcRequestInit } from './api'
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
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError')
  const pending = ipc.invoke(IPC_OIDC_HTTP_REQUEST, request)
  const result = signal
    ? await new Promise<unknown>((resolve, reject) => {
        const onAbort = () => reject(new DOMException('The operation was aborted', 'AbortError'))
        signal.addEventListener('abort', onAbort, { once: true })
        pending.then(
          (value) => { signal.removeEventListener('abort', onAbort); resolve(value) },
          (error) => { signal.removeEventListener('abort', onAbort); reject(error) },
        )
      })
    : await pending
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
  // Literal authorize URL the renderer is about to navigate to.
  // Supplying it lets main-process compare the incoming navigation by
  // canonicalized string equality instead of rebuilding the URL from
  // (origin + provider id) — see main/oidcRedirect.ts::isOidcAuthorizeNavigation
  // and P1-1 in the review notes for the rationale.
  authorizeUrl: string,
): Promise<OidcAuthorizeStartResult> {
  const ipc = typeof window !== 'undefined' ? (window as any).ipc : undefined
  if (typeof ipc?.invoke !== 'function') return { ok: false, code: 'no-window' }
  return ipc.invoke(IPC_OIDC_AUTHORIZE_START, apiURL, authcode, providerId, authorizeUrl) as Promise<OidcAuthorizeStartResult>
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
        async get<T>(url: string, init?: OidcRequestInit): Promise<T> {
          const absoluteURL = new URL(url, apiURL.endsWith('/') ? apiURL : `${apiURL}/`).toString()
          return invokeOidcHttp<T>(ipc, { url: absoluteURL, method: 'GET' }, init?.signal)
        },
        async post<T>(url: string, body: unknown, init?: OidcRequestInit): Promise<T> {
          const absoluteURL = new URL(url, apiURL.endsWith('/') ? apiURL : `${apiURL}/`).toString()
          return invokeOidcHttp<T>(ipc, {
            url: absoluteURL,
            method: 'POST',
            body,
          }, init?.signal)
        },
      }
    }
    return createFetchHttpClient(apiURL)
  }
  return fetchHttpClient
}
