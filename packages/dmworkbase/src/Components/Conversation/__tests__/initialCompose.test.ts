import { describe, it, expect, vi } from 'vitest'
import {
  tryConsumeInitialCompose,
  type ComposeHost,
  type InitialCompose,
  type InitialComposeState,
} from '../initialCompose.ts'

// A programmable fake of the composer surface. Records the exact call order so tests can assert
// restoreDraft → addPendingAttachments → send (plan §5.1).
function makeHost(
  over: Partial<ComposeHost> & {
    attachErr?: string
    sendThrows?: boolean
    sendResult?: boolean | { editorConsumed: boolean }
  } = {},
) {
  const order: string[] = []
  const host: ComposeHost & { order: string[] } = {
    order,
    isReady: over.isReady ?? (() => true),
    isLive: over.isLive,
    currentDraftText: over.currentDraftText ?? (() => ''),
    pendingAttachmentCount: over.pendingAttachmentCount ?? (() => 0),
    restoreDraft: vi.fn((_t: string) => {
      order.push('restoreDraft')
    }),
    addPendingAttachments: vi.fn((_f: File[]) => {
      order.push('addPendingAttachments')
      return over.attachErr ?? null
    }),
    send: vi.fn(async () => {
      order.push('send')
      if (over.sendThrows) throw new Error('send-failed')
      return over.sendResult
    }),
  }
  return host
}

const compose = (over: Partial<InitialCompose> = {}): InitialCompose => ({
  requestId: 'req-1',
  text: 'task text',
  files: [],
  autoSend: true,
  ...over,
})

const file = (name = 'a.png') => new File(['x'], name, { type: 'image/png' })

describe('tryConsumeInitialCompose', () => {
  it('waits (does not consume) until MessageInput is ready', async () => {
    const host = makeHost({ isReady: () => false })
    const consumed = new Set<string>()
    const res = await tryConsumeInitialCompose(compose(), host, consumed)
    expect(res.consumed).toBe(false)
    expect(consumed.size).toBe(0)
    expect(host.send).not.toHaveBeenCalled()
    // A later ready-retry with the same set DOES fire.
    const readyHost = makeHost()
    const res2 = await tryConsumeInitialCompose(compose(), readyHost, consumed)
    expect(res2.state).toBe('sent')
    expect(consumed.has('req-1')).toBe(true)
  })

  it('loads text, attachments, then sends — in that strict order', async () => {
    const host = makeHost()
    const states: InitialComposeState[] = []
    const res = await tryConsumeInitialCompose(
      compose({ files: [file()] }),
      host,
      new Set(),
      (_id, s) => states.push(s),
    )
    expect(host.order).toEqual(['restoreDraft', 'addPendingAttachments', 'send'])
    expect(res.state).toBe('sent')
    expect(states).toEqual(['sent'])
  })

  it('waits for asynchronous attachment staging before sending', async () => {
    let finishStaging!: () => void
    const staging = new Promise<void>((resolve) => { finishStaging = resolve })
    const host = makeHost()
    host.addPendingAttachments = vi.fn(async () => {
      host.order.push('addPendingAttachments:start')
      await staging
      host.order.push('addPendingAttachments:ready')
      return null
    })

    const consuming = tryConsumeInitialCompose(compose({ files: [file()] }), host, new Set())
    await Promise.resolve()
    expect(host.send).not.toHaveBeenCalled()
    expect(host.order).toEqual(['restoreDraft', 'addPendingAttachments:start'])

    finishStaging()
    const result = await consuming
    expect(host.order).toEqual([
      'restoreDraft',
      'addPendingAttachments:start',
      'addPendingAttachments:ready',
      'send',
    ])
    expect(result.state).toBe('sent')
  })

  it.each(['unmount', 'channel switch', 'Space switch'])(
    'does not send after async staging when abandoned by %s',
    async () => {
    let finishStaging!: () => void
    const staging = new Promise<void>((resolve) => { finishStaging = resolve })
    let live = true
    const host = makeHost({ isLive: () => live })
    host.addPendingAttachments = vi.fn(async () => {
      await staging
      return null
    })

    const consuming = tryConsumeInitialCompose(compose({ files: [file()] }), host, new Set())
    live = false
    finishStaging()

      await expect(consuming).resolves.toMatchObject({ consumed: true, reason: 'compose-cancelled' })
      expect(host.send).not.toHaveBeenCalled()
    },
  )

  it('catches attachment staging rejection and reports failed', async () => {
    const host = makeHost()
    host.addPendingAttachments = vi.fn().mockRejectedValue(new Error('staging crashed'))
    const emit = vi.fn()
    const res = await tryConsumeInitialCompose(compose({ files: [file()] }), host, new Set(), emit)
    expect(host.send).not.toHaveBeenCalled()
    expect(res).toMatchObject({ state: 'failed', reason: 'staging crashed' })
    expect(emit).toHaveBeenCalledWith('req-1', 'failed', 'staging crashed')
  })

  it('aborts before send and reports failed when attachment validation fails, keeping the text', async () => {
    const host = makeHost({ attachErr: 'file too large' })
    const res = await tryConsumeInitialCompose(compose({ files: [file()] }), host, new Set())
    // Text was restored, attachment was attempted, but send was NOT called.
    expect(host.restoreDraft).toHaveBeenCalledWith('task text')
    expect(host.order).toEqual(['restoreDraft', 'addPendingAttachments'])
    expect(host.send).not.toHaveBeenCalled()
    expect(res.state).toBe('failed')
    expect(res.reason).toBe('file too large')
  })

  it('refuses to overwrite an existing non-empty draft and reports failed', async () => {
    const host = makeHost({ currentDraftText: () => 'user was typing' })
    const emit = vi.fn()
    const res = await tryConsumeInitialCompose(compose(), host, new Set(), emit)
    expect(host.restoreDraft).not.toHaveBeenCalled()
    expect(host.send).not.toHaveBeenCalled()
    expect(res.state).toBe('failed')
    expect(res.reason).toBe('draft-conflict')
    expect(emit).toHaveBeenCalledWith('req-1', 'failed', 'draft-conflict')
  })

  it('refuses when there are already pending attachments', async () => {
    const host = makeHost({ pendingAttachmentCount: () => 2 })
    const res = await tryConsumeInitialCompose(compose(), host, new Set())
    expect(res.state).toBe('failed')
    expect(res.reason).toBe('draft-conflict')
    expect(host.send).not.toHaveBeenCalled()
  })

  it('consumes a requestId at most once across re-renders / prop re-passes', async () => {
    const consumed = new Set<string>()
    const host = makeHost()
    const first = await tryConsumeInitialCompose(compose(), host, consumed)
    expect(first.state).toBe('sent')
    // Same requestId again (React re-render / prop re-pass): no second send.
    const second = await tryConsumeInitialCompose(compose(), host, consumed)
    expect(second.consumed).toBe(false)
    expect(host.send).toHaveBeenCalledTimes(1)
  })

  it('allows a NEW requestId to be consumed after a previous one', async () => {
    const consumed = new Set<string>()
    const h1 = makeHost()
    await tryConsumeInitialCompose(compose({ requestId: 'req-1' }), h1, consumed)
    const h2 = makeHost()
    const res = await tryConsumeInitialCompose(compose({ requestId: 'req-2' }), h2, consumed)
    expect(res.state).toBe('sent')
    expect(h2.send).toHaveBeenCalledTimes(1)
    expect(consumed.has('req-1')).toBe(true)
    expect(consumed.has('req-2')).toBe(true)
  })

  it('prefills without sending when autoSend is false', async () => {
    const host = makeHost()
    const res = await tryConsumeInitialCompose(compose({ autoSend: false }), host, new Set())
    expect(host.restoreDraft).toHaveBeenCalledWith('task text')
    expect(host.send).not.toHaveBeenCalled()
    expect(res.state).toBe('prepared')
  })

  it('reports failed (but stays consumed) when send throws', async () => {
    const host = makeHost({ sendThrows: true })
    const consumed = new Set<string>()
    const res = await tryConsumeInitialCompose(compose(), host, consumed)
    expect(res.state).toBe('failed')
    expect(res.reason).toBe('send-failed')
    // Still consumed — a failed send must not auto-retry on the next render (user retries manually).
    expect(consumed.has('req-1')).toBe(true)
  })

  // P1 fix: host.send returning a falsy outcome (draft preserved = send rejected) must be
  // reported as 'failed', not mis-reported as a successful 'sent'.
  it('reports failed (not sent) when send resolves false (draft preserved / rejected)', async () => {
    const host = makeHost({ sendResult: false })
    const emit = vi.fn()
    const res = await tryConsumeInitialCompose(compose(), host, new Set(), emit)
    expect(host.send).toHaveBeenCalledTimes(1)
    expect(res.state).toBe('failed')
    expect(res.reason).toBe('send-rejected')
    expect(emit).toHaveBeenCalledWith('req-1', 'failed', 'send-rejected')
    // Must NOT have emitted a bogus 'sent'.
    expect(emit).not.toHaveBeenCalledWith('req-1', 'sent')
  })

  it('reports failed when send resolves { editorConsumed: false }', async () => {
    const host = makeHost({ sendResult: { editorConsumed: false } })
    const res = await tryConsumeInitialCompose(compose(), host, new Set())
    expect(res.state).toBe('failed')
    expect(res.reason).toBe('send-rejected')
  })

  it('reports sent when send resolves true', async () => {
    const host = makeHost({ sendResult: true })
    const res = await tryConsumeInitialCompose(compose(), host, new Set())
    expect(res.state).toBe('sent')
  })

  it('reports sent when send resolves { editorConsumed: true }', async () => {
    const host = makeHost({ sendResult: { editorConsumed: true } })
    const res = await tryConsumeInitialCompose(compose(), host, new Set())
    expect(res.state).toBe('sent')
  })

  it('treats a void send resolution as sent (legacy void-returning send path)', async () => {
    const host = makeHost() // send returns undefined
    const res = await tryConsumeInitialCompose(compose(), host, new Set())
    expect(res.state).toBe('sent')
  })

  it('is a no-op when no compose is provided', async () => {
    const host = makeHost()
    const res = await tryConsumeInitialCompose(undefined, host, new Set())
    expect(res.consumed).toBe(false)
    expect(host.send).not.toHaveBeenCalled()
  })
})
