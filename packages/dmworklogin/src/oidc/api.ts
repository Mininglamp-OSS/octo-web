import type { OidcAuthStatus } from './types'

export interface AuthcodeResponse {
  authcode: string
}

export interface AuthStatusResponse {
  status: OidcAuthStatus
  result?: {
    uid?: string
    token?: string
    name?: string
    [key: string]: unknown
  }
  msg?: string
}

export interface OidcRequestInit {
  signal?: AbortSignal
}

export interface OidcHttpClient {
  get<T>(url: string, init?: OidcRequestInit): Promise<T>
  post<T>(url: string, body: unknown, init?: OidcRequestInit): Promise<T>
}

const AUTHCODE_PATH = '/v1/user/thirdlogin/authcode'
const AUTHSTATUS_PATH = '/v1/user/thirdlogin/authstatus'

export async function fetchAuthcode(
  client: OidcHttpClient,
  init?: OidcRequestInit,
): Promise<string> {
  const resp = await client.get<AuthcodeResponse>(AUTHCODE_PATH, init)
  if (!resp || typeof resp.authcode !== 'string' || resp.authcode === '') {
    throw new Error('Invalid authcode response')
  }
  return resp.authcode
}

export async function fetchAuthStatus(
  client: OidcHttpClient,
  authcode: string,
  init?: OidcRequestInit,
): Promise<AuthStatusResponse> {
  const qs = new URLSearchParams({ authcode }).toString()
  const resp = await client.get<unknown>(`${AUTHSTATUS_PATH}?${qs}`, init)
  if (!resp || typeof resp !== 'object') {
    throw new Error('Invalid authstatus response')
  }
  const r = resp as Record<string, unknown>
  if (typeof r.status !== 'number') {
    throw new Error('Invalid authstatus response: status must be number')
  }
  if (r.status === 1) {
    const result = r.result as Record<string, unknown> | undefined
    if (
      !result ||
      typeof result.uid !== 'string' ||
      result.uid === '' ||
      typeof result.token !== 'string' ||
      result.token === ''
    ) {
      throw new Error('Invalid authstatus success response: missing uid or token')
    }
  }
  return resp as AuthStatusResponse
}
