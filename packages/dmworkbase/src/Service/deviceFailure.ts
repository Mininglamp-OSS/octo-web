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
 * Trigger condition: HTTP 400 + backend code 'err.server.user.device_not_found'.
 * All other errors (auth, network, 5xx) are intentionally ignored — they have
 * their own handling paths (auth interceptor / silent failure).
 *
 * See octo-web#76.
 */
export function handleDeviceFetchError(
  err: APIClientRejectedError,
  handlers: DeviceFailureHandlers,
): void {
  if (err.status === 400 && err.code === 'err.server.user.device_not_found') {
    handlers.removeDeviceId()
    handlers.resetInMemoryDeviceId()
    handlers.triggerLogout()
  }
}
