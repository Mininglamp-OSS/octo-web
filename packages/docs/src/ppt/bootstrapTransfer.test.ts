import { describe, it, expect, vi } from 'vitest'
import {
  PPT_BOOTSTRAP_PROTOCOL,
  isTrustedOrigin,
  isBootstrapRequest,
  isBootstrapDeliver,
  deliverBootstrap,
  serveBootstrap,
  currentOrigin,
  type PptBootstrap,
  type BootstrapRequestMessage,
} from './bootstrapTransfer.ts'

const SAME = () => window.location.origin
const CROSS = 'https://evil.example.com'

function bootstrap(docId = 'd_1'): PptBootstrap {
  return { mode: 'editor', docId, version: 'latest', sourceUrl: `/ppt/docs/${docId}/source?format=bento`, canEdit: true }
}

function request(docId = 'd_1', mode: BootstrapRequestMessage['mode'] = 'editor'): BootstrapRequestMessage {
  return { protocol: PPT_BOOTSTRAP_PROTOCOL, type: 'request', docId, mode }
}

/** Injectable event target that captures the single message handler so a test can dispatch to it. */
function makeTarget() {
  let handler: ((e: MessageEvent) => void) | undefined
  return {
    addEventListener: vi.fn((_type: string, h: EventListener) => {
      handler = h as unknown as (e: MessageEvent) => void
    }),
    removeEventListener: vi.fn(() => {
      handler = undefined
    }),
    dispatch(evt: Partial<MessageEvent>) {
      handler?.(evt as MessageEvent)
    },
    get hasHandler() {
      return Boolean(handler)
    },
  }
}

/** A fake same-origin frame window whose postMessage is a spy. */
function fakeSource() {
  return { postMessage: vi.fn() } as unknown as Window & { postMessage: ReturnType<typeof vi.fn> }
}

describe('isTrustedOrigin', () => {
  it('trusts only the current document origin', () => {
    expect(isTrustedOrigin(SAME())).toBe(true)
    expect(currentOrigin()).toBe(SAME())
  })
  it('rejects a different origin, the wildcard, empty, and null', () => {
    expect(isTrustedOrigin(CROSS)).toBe(false)
    expect(isTrustedOrigin('*')).toBe(false)
    expect(isTrustedOrigin('')).toBe(false)
    expect(isTrustedOrigin('null')).toBe(false)
    expect(isTrustedOrigin(null)).toBe(false)
    expect(isTrustedOrigin(undefined)).toBe(false)
  })
})

describe('message type guards', () => {
  it('accepts well-formed request / deliver and rejects malformed', () => {
    expect(isBootstrapRequest(request())).toBe(true)
    expect(isBootstrapRequest({ protocol: PPT_BOOTSTRAP_PROTOCOL, type: 'request', docId: '', mode: 'editor' })).toBe(false)
    expect(isBootstrapRequest({ protocol: 'other', type: 'request', docId: 'd', mode: 'editor' })).toBe(false)
    expect(isBootstrapRequest({ protocol: PPT_BOOTSTRAP_PROTOCOL, type: 'request', docId: 'd', mode: 'bogus' })).toBe(false)
    expect(isBootstrapRequest(null)).toBe(false)
    expect(isBootstrapDeliver({ protocol: PPT_BOOTSTRAP_PROTOCOL, type: 'deliver', bootstrap: bootstrap() })).toBe(true)
    expect(isBootstrapDeliver({ protocol: PPT_BOOTSTRAP_PROTOCOL, type: 'deliver', bootstrap: null })).toBe(false)
  })
})

describe('deliverBootstrap', () => {
  it('posts to a same-origin target pinned to that origin (never a wildcard)', () => {
    const target = fakeSource()
    deliverBootstrap(target, SAME(), bootstrap())
    expect(target.postMessage).toHaveBeenCalledTimes(1)
    const [msg, origin] = target.postMessage.mock.calls[0]
    expect(origin).toBe(SAME())
    expect(origin).not.toBe('*')
    expect(msg).toMatchObject({ protocol: PPT_BOOTSTRAP_PROTOCOL, type: 'deliver' })
  })
  it('throws rather than deliver to a cross-origin target or the wildcard', () => {
    const target = fakeSource()
    expect(() => deliverBootstrap(target, CROSS, bootstrap())).toThrow()
    expect(() => deliverBootstrap(target, '*', bootstrap())).toThrow()
    expect(target.postMessage).not.toHaveBeenCalled()
  })
})

describe('serveBootstrap — origin-checked handshake', () => {
  it('answers a same-origin, well-formed request by delivering the bootstrap to event.source', () => {
    const target = makeTarget()
    const provide = vi.fn(() => bootstrap())
    serveBootstrap({ provide, eventTarget: target })
    const source = fakeSource()
    target.dispatch({ origin: SAME(), data: request(), source })
    expect(provide).toHaveBeenCalledTimes(1)
    expect(source.postMessage).toHaveBeenCalledTimes(1)
    const [, origin] = source.postMessage.mock.calls[0]
    expect(origin).toBe(SAME())
  })

  // NEGATIVE CONTROL (acceptance): a cross-origin handoff is rejected — no provide, no reply.
  it('rejects a cross-origin request: no bootstrap is produced and no reply is posted', () => {
    const target = makeTarget()
    const provide = vi.fn(() => bootstrap())
    const onReject = vi.fn()
    serveBootstrap({ provide, onReject, eventTarget: target })
    const source = fakeSource()
    target.dispatch({ origin: CROSS, data: request(), source })
    expect(provide).not.toHaveBeenCalled()
    expect(source.postMessage).not.toHaveBeenCalled()
    expect(onReject).toHaveBeenCalledTimes(1)
  })

  it('ignores a same-origin message that is not a well-formed request (no reply)', () => {
    const target = makeTarget()
    const provide = vi.fn(() => bootstrap())
    const onReject = vi.fn()
    serveBootstrap({ provide, onReject, eventTarget: target })
    const source = fakeSource()
    target.dispatch({ origin: SAME(), data: { hello: 'world' }, source })
    expect(provide).not.toHaveBeenCalled()
    expect(source.postMessage).not.toHaveBeenCalled()
    expect(onReject).toHaveBeenCalledTimes(1)
  })

  it('sends no reply when provide declines (returns null)', () => {
    const target = makeTarget()
    serveBootstrap({ provide: () => null, eventTarget: target })
    const source = fakeSource()
    target.dispatch({ origin: SAME(), data: request(), source })
    expect(source.postMessage).not.toHaveBeenCalled()
  })

  it('disposer detaches the listener', () => {
    const target = makeTarget()
    const dispose = serveBootstrap({ provide: () => bootstrap(), eventTarget: target })
    expect(target.hasHandler).toBe(true)
    dispose()
    expect(target.removeEventListener).toHaveBeenCalledTimes(1)
    expect(target.hasHandler).toBe(false)
  })
})
