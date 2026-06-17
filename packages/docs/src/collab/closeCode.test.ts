import { describe, it, expect, vi } from 'vitest'
import { CloseCodeMachine, type CloseCodeActions } from './closeCode.ts'

function makeActions(): CloseCodeActions & { [k: string]: ReturnType<typeof vi.fn> | (() => number) } {
  return {
    disposeToken: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    goLogin: vi.fn(),
    showForbidden: vi.fn(),
    exitDocument: vi.fn(),
    showLockedOrArchived: vi.fn(),
    clearDocCache: vi.fn(),
    rollbackPending: vi.fn(),
    onTransientClose: vi.fn(),
    deferReconnect: vi.fn(),
    reportServerError: vi.fn(),
    backoffDelay: () => 1000,
  } as unknown as CloseCodeActions & Record<string, ReturnType<typeof vi.fn>>
}

describe('CloseCodeMachine — 4401 refresh-once per generation', () => {
  it('first 4401 disposes token and reconnects once', () => {
    const a = makeActions()
    const m = new CloseCodeMachine(a)
    m.handleClose({ code: 4401 })
    expect(a.disposeToken).toHaveBeenCalledTimes(1)
    expect(a.connect).toHaveBeenCalledTimes(1)
    expect(m.isTerminated()).toBe(false)
  })

  it('second 4401 in same generation terminates and goes to login (no livelock)', () => {
    const a = makeActions()
    const m = new CloseCodeMachine(a)
    m.handleClose({ code: 4401 })
    m.handleClose({ code: 4401 })
    expect(a.connect).toHaveBeenCalledTimes(1) // not reconnected again
    expect(a.disconnect).toHaveBeenCalledTimes(1)
    expect(a.goLogin).toHaveBeenCalledTimes(1)
    expect(m.isTerminated()).toBe(true)
  })

  it('onAuthStable resets the per-generation refresh flag, allowing another refresh', () => {
    const a = makeActions()
    const m = new CloseCodeMachine(a)
    m.handleClose({ code: 4401 })
    m.onAuthStable() // authenticated + synced after the reconnect
    m.handleClose({ code: 4401 })
    expect(a.connect).toHaveBeenCalledTimes(2)
    expect(m.isTerminated()).toBe(false)
    expect(m.getAuthGeneration()).toBe(1)
  })

  it('terminated guard swallows close echoes after a terminal code', () => {
    const a = makeActions()
    const m = new CloseCodeMachine(a)
    m.handleClose({ code: 4403 })
    ;(a.onTransientClose as ReturnType<typeof vi.fn>).mockClear()
    m.handleClose({ code: 1006 }) // echo from the disconnect
    m.handleClose({ code: 4401 })
    expect((a.onTransientClose as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
    expect(a.connect).not.toHaveBeenCalled()
  })
})

describe('CloseCodeMachine — terminal codes', () => {
  it('4403 terminates, rolls back, clears cache, shows forbidden', () => {
    const a = makeActions()
    const m = new CloseCodeMachine(a)
    m.handleClose({ code: 4403 })
    expect(m.isTerminated()).toBe(true)
    expect(a.disconnect).toHaveBeenCalled()
    expect(a.rollbackPending).toHaveBeenCalled()
    expect(a.clearDocCache).toHaveBeenCalled()
    expect(a.showForbidden).toHaveBeenCalled()
  })

  it('4404 terminates, clears cache, exits document', () => {
    const a = makeActions()
    const m = new CloseCodeMachine(a)
    m.handleClose({ code: 4404 })
    expect(m.isTerminated()).toBe(true)
    expect(a.clearDocCache).toHaveBeenCalled()
    expect(a.exitDocument).toHaveBeenCalled()
  })

  it('4409 terminates and shows locked/archived', () => {
    const a = makeActions()
    const m = new CloseCodeMachine(a)
    m.handleClose({ code: 4409 })
    expect(m.isTerminated()).toBe(true)
    expect(a.showLockedOrArchived).toHaveBeenCalled()
  })
})

describe('CloseCodeMachine — backoff codes', () => {
  it('4429 disconnects then defers a single reconnect using Retry-After', () => {
    const a = makeActions()
    const m = new CloseCodeMachine(a)
    m.handleClose({ code: 4429, retryAfterSeconds: 12 })
    expect(a.disconnect).toHaveBeenCalled()
    expect(a.deferReconnect).toHaveBeenCalledWith({ delayMs: 12000, reason: 'rate-limited-4429' })
    expect(m.isTerminated()).toBe(false)
  })

  it('4429 falls back to backoffDelay when Retry-After absent', () => {
    const a = makeActions()
    const m = new CloseCodeMachine(a)
    m.handleClose({ code: 4429 })
    expect(a.deferReconnect).toHaveBeenCalledWith({ delayMs: 1000, reason: 'rate-limited-4429' })
  })

  it('1011 reports the error and reconnects with limited backoff', () => {
    const a = makeActions()
    const m = new CloseCodeMachine(a)
    m.handleClose({ code: 1011 })
    expect(a.reportServerError).toHaveBeenCalled()
    expect(a.onTransientClose).toHaveBeenCalled()
  })

  it('unknown/network codes go through the single transient reconnect source', () => {
    const a = makeActions()
    const m = new CloseCodeMachine(a)
    m.handleClose({ code: 1006 })
    expect(a.onTransientClose).toHaveBeenCalled()
  })
})
