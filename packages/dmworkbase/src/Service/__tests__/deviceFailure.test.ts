// packages/dmworkbase/src/Service/__tests__/deviceFailure.test.ts
import { describe, it, expect, vi } from 'vitest'
import { handleDeviceFetchError } from '../deviceFailure'
import type { APIClientRejectedError } from '../APIClient'

function makeRejected(overrides: Partial<APIClientRejectedError>): APIClientRejectedError {
  return {
    error: new Error('stub'),
    msg: '',
    status: undefined as any,
    code: '',
    details: undefined,
    backendMessage: undefined,
    normalized: undefined as any,
    ...overrides,
  } as APIClientRejectedError
}

describe('handleDeviceFetchError', () => {
  it('on 400 with err.server.user.device_not_found, invokes all three handlers', () => {
    const removeDeviceId = vi.fn()
    const resetInMemoryDeviceId = vi.fn()
    const triggerLogout = vi.fn()
    const err = makeRejected({ status: 400, code: 'err.server.user.device_not_found' })

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
    const err = makeRejected({ status: undefined as any, code: '' })

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
})
