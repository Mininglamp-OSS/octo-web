import type { APIClientRejectedError } from './APIClient'

export interface DeviceFailureHandlers {
  removeDeviceId: () => void
  resetInMemoryDeviceId: () => void
  triggerLogout: () => void
}

/**
 * Classify a rejected device-fetch error and invoke recovery handlers if it
 * represents a stale device_id (server doesn't recognize it).
 *
 * Trigger condition: backend code 'err.server.user.device_not_found'.
 * (HTTP status not checked — APIClient.normalizeApiError exposes
 * body.error.http_status, not the real HTTP status code, and the two diverge
 * for this endpoint. Code-only gating is more robust.)
 * All other errors (auth, network, 5xx) are intentionally ignored — they have
 * their own handling paths (auth interceptor / silent failure).
 *
 * See octo-web#76.
 */
export function handleDeviceFetchError(
  err: APIClientRejectedError,
  handlers: DeviceFailureHandlers,
): void {
  // Gate by code only. The HTTP status line is 400 Bad Request, but
  // APIClient.normalizeApiError reads the body's inconsistent `http_status`
  // field (=404) into err.status, not the actual HTTP status code. The code
  // string is the stable backend contract — that's what we match on.
  if (err.code === 'err.server.user.device_not_found') {
    handlers.removeDeviceId()
    handlers.resetInMemoryDeviceId()
    handlers.triggerLogout()
  }
}
