// packages/dmworkbase/src/Service/__tests__/deviceFailure.test.ts
import { describe, it, expect, vi } from 'vitest'
import { handleDeviceFetchError } from '../deviceFailure'
import type { APIClientRejectedError } from '../APIClient'

function makeRejected(overrides: Partial<APIClientRejectedError>): APIClientRejectedError {
  return {
    error: new Error('stub'),
    msg: '',
    code: '',
    details: undefined,
    backendMessage: undefined,
    normalized: { message: '', raw: undefined },
    ...overrides,
  }
}

describe('handleDeviceFetchError', () => {
  it('on err.server.user.device_not_found code (production status 404), invokes all three handlers', () => {
    const removeDeviceId = vi.fn()
    const resetInMemoryDeviceId = vi.fn()
    const triggerLogout = vi.fn()
    const err = makeRejected({ status: 404, code: 'err.server.user.device_not_found' })

    handleDeviceFetchError(err, { removeDeviceId, resetInMemoryDeviceId, triggerLogout })

    expect(removeDeviceId).toHaveBeenCalledTimes(1)
    expect(resetInMemoryDeviceId).toHaveBeenCalledTimes(1)
    expect(triggerLogout).toHaveBeenCalledTimes(1)
  })

  it('on 401 (auth expired), does NOT invoke any handler', () => {
    const removeDeviceId = vi.fn()
    const resetInMemoryDeviceId = vi.fn()
    const triggerLogout = vi.fn()
    const err = makeRejected({ status: 401, code: 'err.shared.auth.token_missing' })

    handleDeviceFetchError(err, { removeDeviceId, resetInMemoryDeviceId, triggerLogout })

    expect(removeDeviceId).not.toHaveBeenCalled()
    expect(resetInMemoryDeviceId).not.toHaveBeenCalled()
    expect(triggerLogout).not.toHaveBeenCalled()
  })

  it('on network error (no response, status undefined), does NOT invoke any handler', () => {
    const removeDeviceId = vi.fn()
    const resetInMemoryDeviceId = vi.fn()
    const triggerLogout = vi.fn()
    const err = makeRejected({ code: '' })

    handleDeviceFetchError(err, { removeDeviceId, resetInMemoryDeviceId, triggerLogout })

    expect(removeDeviceId).not.toHaveBeenCalled()
    expect(resetInMemoryDeviceId).not.toHaveBeenCalled()
    expect(triggerLogout).not.toHaveBeenCalled()
  })

  it('on 400 with a different error code, does NOT invoke any handler', () => {
    const removeDeviceId = vi.fn()
    const resetInMemoryDeviceId = vi.fn()
    const triggerLogout = vi.fn()
    const err = makeRejected({ status: 400, code: 'err.shared.request.invalid' })

    handleDeviceFetchError(err, { removeDeviceId, resetInMemoryDeviceId, triggerLogout })

    expect(removeDeviceId).not.toHaveBeenCalled()
    expect(resetInMemoryDeviceId).not.toHaveBeenCalled()
    expect(triggerLogout).not.toHaveBeenCalled()
  })

  it('on the device_not_found code regardless of status field value, still triggers', () => {
    const removeDeviceId = vi.fn()
    const resetInMemoryDeviceId = vi.fn()
    const triggerLogout = vi.fn()
    // Defensive: even if the backend ever flips its inconsistent http_status
    // field to something else (e.g. 400 matching the real HTTP status), the
    // code-only gate must still trigger.
    const err = makeRejected({ status: 400, code: 'err.server.user.device_not_found' })

    handleDeviceFetchError(err, { removeDeviceId, resetInMemoryDeviceId, triggerLogout })

    expect(removeDeviceId).toHaveBeenCalledTimes(1)
    expect(resetInMemoryDeviceId).toHaveBeenCalledTimes(1)
    expect(triggerLogout).toHaveBeenCalledTimes(1)
  })
})
