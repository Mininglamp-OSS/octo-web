import { describe, it, expect, vi } from 'vitest'
import {
  pollAuthStatus,
  OidcPollTimeoutError,
  OidcPollCancelledError,
  OidcPollNetworkError,
} from '../poller'
import type { AuthStatusResponse, OidcHttpClient } from '../api'

function makeClient(
  responses: AuthStatusResponse[],
): { client: OidcHttpClient; calls: { url: string }[] } {
  const calls: { url: string }[] = []
  const queue = [...responses]
  const client: OidcHttpClient = {
    get: vi.fn(async (url: string) => {
      calls.push({ url })
      const next = queue.shift()
      if (!next) throw new Error('No more queued responses')
      return next as never
    }),
    post: vi.fn(),
  }
  return { client, calls }
}

const noSleep = async () => {}

describe('pollAuthStatus', () => {
  it('returns immediately on success (status=1)', async () => {
    const { client } = makeClient([{ status: 1, result: { uid: 'u', token: 't' } }])
    const result = await pollAuthStatus({
      client,
      authcode: 'x',
      intervalMs: 1,
      maxAttempts: 5,
      sleep: noSleep,
    })
    expect(result.status).toBe(1)
    expect(result.result?.uid).toBe('u')
  })

  it('returns on failure (status=2)', async () => {
    const { client } = makeClient([{ status: 2, msg: 'expired' }])
    const result = await pollAuthStatus({
      client,
      authcode: 'x',
      intervalMs: 1,
      maxAttempts: 5,
      sleep: noSleep,
    })
    expect(result.status).toBe(2)
    expect(result.msg).toBe('expired')
  })

  it('keeps polling on pending (status=0) until success', async () => {
    const { client } = makeClient([
      { status: 0 },
      { status: 0 },
      { status: 1, result: { uid: 'u', token: 't' } },
    ])
    const sleep = vi.fn(async () => {})
    const result = await pollAuthStatus({
      client,
      authcode: 'x',
      intervalMs: 100,
      maxAttempts: 10,
      sleep,
    })
    expect(result.status).toBe(1)
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(100)
  })

  it('throws OidcPollTimeoutError after maxAttempts pending responses', async () => {
    const { client } = makeClient([{ status: 0 }, { status: 0 }, { status: 0 }])
    await expect(
      pollAuthStatus({
        client,
        authcode: 'x',
        intervalMs: 1,
        maxAttempts: 3,
        sleep: noSleep,
      }),
    ).rejects.toBeInstanceOf(OidcPollTimeoutError)
  })

  it('retries through transient network errors and resumes on success', async () => {
    const responses: (AuthStatusResponse | Error)[] = [
      new Error('network down'),
      new Error('network down'),
      { status: 1, result: { uid: 'u', token: 't' } },
    ]
    const client: OidcHttpClient = {
      get: vi.fn(async () => {
        const next = responses.shift()
        if (next instanceof Error) throw next
        if (!next) throw new Error('exhausted')
        return next as never
      }),
      post: vi.fn(),
    }
    const result = await pollAuthStatus({
      client,
      authcode: 'x',
      intervalMs: 1,
      maxAttempts: 5,
      sleep: noSleep,
      maxConsecutiveErrors: 5,
    })
    expect(result.status).toBe(1)
  })

  it('throws OidcPollNetworkError after maxConsecutiveErrors network failures', async () => {
    const client: OidcHttpClient = {
      get: vi.fn(async () => {
        throw new Error('network down')
      }),
      post: vi.fn(),
    }
    await expect(
      pollAuthStatus({
        client,
        authcode: 'x',
        intervalMs: 1,
        maxAttempts: 10,
        sleep: noSleep,
        maxConsecutiveErrors: 3,
      }),
    ).rejects.toBeInstanceOf(OidcPollNetworkError)
  })

  it('resets the consecutive-error counter on a successful response', async () => {
    const queue: (AuthStatusResponse | Error)[] = [
      new Error('blip'),
      new Error('blip'),
      { status: 0 },
      new Error('blip'),
      new Error('blip'),
      { status: 1, result: { uid: 'u', token: 't' } },
    ]
    const client: OidcHttpClient = {
      get: vi.fn(async () => {
        const next = queue.shift()
        if (next instanceof Error) throw next
        if (!next) throw new Error('exhausted')
        return next as never
      }),
      post: vi.fn(),
    }
    const result = await pollAuthStatus({
      client,
      authcode: 'x',
      intervalMs: 1,
      maxAttempts: 10,
      sleep: noSleep,
      maxConsecutiveErrors: 3,
    })
    expect(result.status).toBe(1)
  })

  it('passes signal through to client and aborts in-flight fetch on cancel', async () => {
    const ac = new AbortController()
    const client: OidcHttpClient = {
      get: vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
        // Simulate a long-running fetch that listens for abort.
        return await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }) as never
      }),
      post: vi.fn(),
    }
    const promise = pollAuthStatus({
      client,
      authcode: 'x',
      intervalMs: 1,
      maxAttempts: 5,
      sleep: noSleep,
      signal: ac.signal,
    })
    // Abort almost immediately — fetch rejects, poller sees signal.aborted, throws Cancelled.
    queueMicrotask(() => ac.abort())
    await expect(promise).rejects.toBeInstanceOf(OidcPollCancelledError)
  })

  it('does not count an aborted fetch toward consecutive errors', async () => {
    const ac = new AbortController()
    const client: OidcHttpClient = {
      get: vi.fn(async () => {
        throw new DOMException('aborted', 'AbortError')
      }),
      post: vi.fn(),
    }
    ac.abort()
    await expect(
      pollAuthStatus({
        client,
        authcode: 'x',
        intervalMs: 1,
        maxAttempts: 10,
        sleep: noSleep,
        signal: ac.signal,
        // If aborts were counted as network errors this would throw NetworkError
        // after maxConsecutiveErrors. Instead Cancelled should win.
        maxConsecutiveErrors: 3,
      }),
    ).rejects.toBeInstanceOf(OidcPollCancelledError)
  })

  it('throws OidcPollCancelledError when isCancelled returns true', async () => {
    const { client } = makeClient([{ status: 0 }, { status: 0 }])
    let cancelled = false
    const sleep = vi.fn(async () => {
      cancelled = true
    })
    await expect(
      pollAuthStatus({
        client,
        authcode: 'x',
        intervalMs: 1,
        maxAttempts: 10,
        sleep,
        isCancelled: () => cancelled,
      }),
    ).rejects.toBeInstanceOf(OidcPollCancelledError)
  })
})
