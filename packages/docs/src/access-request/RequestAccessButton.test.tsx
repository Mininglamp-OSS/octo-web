// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import { RequestAccessButton } from './RequestAccessButton.tsx'

let wk: ReturnType<typeof createMockWKApp>

beforeEach(() => {
  wk = createMockWKApp()
  setWKApp(wk)
})

afterEach(() => cleanup())

describe('RequestAccessButton — user + Bot access request (task #2/#3)', () => {
  it('lists the requester\'s own Space Bots default-selected and submits them all', async () => {
    // The owner-scoped endpoint returns only the caller's own Bots (server enforces owner + Space).
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/robot/owned_bots')) {
        return {
          data: [
            { uid: 'b_mine1', name: 'My Writer' },
            { uid: 'b_mine2', name: 'My Review' },
          ],
          status: 200,
        }
      }
      return { data: {}, status: 201 }
    }
    render(<RequestAccessButton docId="d_1" spaceId="s_1" />)
    await waitFor(() => expect(screen.getByText('My Writer')).toBeTruthy())
    expect(screen.getByText('My Review')).toBeTruthy()
    // Ownership is resolved server-side: no space-wide catalog read, no client-side creator filter.
    expect(wk.apiClient.calls.some((c) => c.url.startsWith('/robot/space_bots'))).toBe(false)
    const owned = wk.apiClient.calls.filter((c) => c.url.startsWith('/robot/owned_bots'))
    expect(owned[0].url).toBe('/robot/owned_bots?space_id=s_1')

    fireEvent.click(screen.getByText('docs.forward.requestAccess'))
    await waitFor(() =>
      expect(wk.apiClient.calls.some((c) => c.method === 'post')).toBe(true),
    )
    const post = wk.apiClient.calls.find((c) => c.method === 'post')!
    expect(post.body).toEqual({ botUids: ['b_mine1', 'b_mine2'] })
  })

  it('disables the request button while Bots are loading', async () => {
    let release: (v: unknown) => void = () => {}
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/robot/owned_bots')) {
        return new Promise((r) => (release = r)) as never
      }
      return { data: {}, status: 201 }
    }
    render(<RequestAccessButton docId="d_1" spaceId="s_1" />)
    // While loading the submit button is disabled (no unknown-Bot request).
    const btn = screen.getByRole('button') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    release({ data: [], status: 200 })
    await waitFor(() => {
      const ready = screen.getByText('docs.forward.requestAccess').closest('button') as HTMLButtonElement
      expect(ready.disabled).toBe(false)
    })
  })

  it('shows a recoverable error + retry when the Bot lookup fails, then succeeds on retry', async () => {
    let attempt = 0
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/robot/owned_bots')) {
        attempt++
        if (attempt === 1) throw new Error('boom')
        return { data: [{ uid: 'b_mine1', name: 'My Writer', creator_uid: 'u_self' }], status: 200 }
      }
      return { data: {}, status: 201 }
    }
    render(<RequestAccessButton docId="d_1" spaceId="s_1" />)
    // Failure surfaces an error + retry; the request button is disabled (never silent human-only).
    await waitFor(() => expect(screen.getByText('docs.forward.requestBotsError')).toBeTruthy())
    const submit = screen.getByText('docs.forward.requestAccess').closest('button') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    // Retry loads the Bots and re-enables the request.
    fireEvent.click(screen.getByText('docs.forward.requestBotsRetry'))
    await waitFor(() => expect(screen.getByText('My Writer')).toBeTruthy())
    fireEvent.click(screen.getByText('docs.forward.requestAccess'))
    await waitFor(() => expect(wk.apiClient.calls.some((c) => c.method === 'post')).toBe(true))
    const post = wk.apiClient.calls.find((c) => c.method === 'post')!
    expect(post.body).toEqual({ botUids: ['b_mine1'] })
  })

  // A shape-degraded 200 must NOT read as "zero Bots": the Bot set is UNKNOWN, so the request stays
  // blocked with a retry instead of silently filing a humans-only access request.
  it('treats a malformed non-array 200 as an error, not zero Bots', async () => {
    let attempt = 0
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/robot/owned_bots')) {
        attempt++
        if (attempt === 1) return { data: { items: [] }, status: 200 }
        return { data: [{ uid: 'b_mine1', name: 'My Writer', creator_uid: 'u_self' }], status: 200 }
      }
      return { data: {}, status: 201 }
    }
    render(<RequestAccessButton docId="d_1" spaceId="s_1" />)
    await waitFor(() => expect(screen.getByText('docs.forward.requestBotsError')).toBeTruthy())
    const blocked = screen.getByText('docs.forward.requestAccess').closest('button') as HTMLButtonElement
    expect(blocked.disabled).toBe(true)
    expect(wk.apiClient.calls.some((c) => c.method === 'post')).toBe(false)
    // Retry reads a well-formed catalog and carries the owned Bot again.
    fireEvent.click(screen.getByText('docs.forward.requestBotsRetry'))
    await waitFor(() => expect(screen.getByText('My Writer')).toBeTruthy())
    fireEvent.click(screen.getByText('docs.forward.requestAccess'))
    await waitFor(() => expect(wk.apiClient.calls.some((c) => c.method === 'post')).toBe(true))
    expect(wk.apiClient.calls.find((c) => c.method === 'post')!.body).toEqual({ botUids: ['b_mine1'] })
  })

  // A 4xx is a permanent verdict about the CALLER, not an unknown Bot set. The standalone share
  // surface exists for outsiders, who are not Space members and therefore always get one from
  // owned_bots; blocking them would remove the pre-feature ability to ask for access at all.
  it('still submits a human-only request when the Bot dimension is forbidden (4xx)', async () => {
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/robot/owned_bots')) {
        // The REAL octo-server shape for a non-Space-member: legacy-compat facade pins the wire
        // status to 400 and carries the true verdict as error.http_status = 403.
        throw {
          response: {
            status: 400,
            data: {
              error: { code: 'err.shared.auth.forbidden', http_status: 403 },
              msg: '无权执行此操作。',
              status: 400,
            },
          },
        }
      }
      return { data: {}, status: 201 }
    }
    render(<RequestAccessButton docId="d_1" spaceId="s_other" />)
    // Informational note, NOT the retryable error, and the primary stays actionable.
    await waitFor(() => expect(screen.getByText('docs.forward.requestBotsUnavailable')).toBeTruthy())
    expect(screen.queryByText('docs.forward.requestBotsError')).toBeNull()
    expect(screen.queryByText('docs.forward.requestBotsRetry')).toBeNull()
    const submit = screen.getByText('docs.forward.requestAccess').closest('button') as HTMLButtonElement
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    await waitFor(() => expect(wk.apiClient.calls.some((c) => c.method === 'post')).toBe(true))
    // Zero Bots carried: the pre-feature request shape (no body).
    expect(wk.apiClient.calls.find((c) => c.method === 'post')!.body).toBeUndefined()
    await waitFor(() => expect(screen.getByText('docs.forward.accessRequested')).toBeTruthy())
  })

  it('keeps 403 unavailable but treats every other failure as retryable, with a human-only hatch', async () => {
    // The full failure matrix, so the fail-open/fail-closed boundary is pinned in ONE place instead of
    // moving each round. `unavailable` = a verdict about the caller (retry cannot help) → submit
    // enabled, human-only. Anything else = Bot set UNKNOWN → primary blocked, Retry + explicit hatch.
    const cases: Array<{ label: string; fail: () => never; unavailable: boolean }> = [
      { label: '401', fail: () => { throw { response: { status: 401 } } }, unavailable: true },
      { label: '403', fail: () => { throw { response: { status: 403 } } }, unavailable: true },
      // The legacy-compat envelope: wire 400, real verdict in error.http_status. Classifying on the
      // wire status alone would block the very requester the unavailable branch exists to unblock.
      {
        label: 'wire 400 + error.http_status 403 (legacy facade)',
        fail: () => { throw { response: { status: 400, data: { error: { http_status: 403 } } } } },
        unavailable: true,
      },
      // A genuine client error that is NOT an authorization verdict must stay unknown, even though the
      // legacy facade gives it the same wire 400.
      {
        label: 'wire 400 + error.http_status 400 (bad request)',
        fail: () => { throw { response: { status: 400, data: { error: { http_status: 400 } } } } },
        unavailable: false,
      },
      { label: 'bare 400 (no envelope)', fail: () => { throw { response: { status: 400 } } }, unavailable: false },
      { label: '404 (route not deployed)', fail: () => { throw { response: { status: 404 } } }, unavailable: false },
      { label: '408', fail: () => { throw { response: { status: 408 } } }, unavailable: false },
      { label: '425', fail: () => { throw { response: { status: 425 } } }, unavailable: false },
      { label: '429', fail: () => { throw { response: { status: 429 } } }, unavailable: false },
      { label: '503', fail: () => { throw { response: { status: 503 } } }, unavailable: false },
      { label: 'network error (no status)', fail: () => { throw new Error('network down') }, unavailable: false },
    ]
    for (const c of cases) {
      wk.apiClient.responder = (method, url) => {
        if (method === 'get' && url.startsWith('/robot/owned_bots')) c.fail()
        return { data: {}, status: 201 }
      }
      render(<RequestAccessButton docId="d_1" spaceId="s_other" />)
      const key = c.unavailable ? 'docs.forward.requestBotsUnavailable' : 'docs.forward.requestBotsError'
      await waitFor(() => expect(screen.getByText(key), c.label).toBeTruthy())
      const submit = screen.getByText('docs.forward.requestAccess').closest('button') as HTMLButtonElement
      expect(submit.disabled, c.label).toBe(!c.unavailable)
      // Neither state is a dead end: unavailable submits directly, unknown offers Retry + "me only".
      expect(!!screen.queryByText('docs.forward.requestSelfOnly'), c.label).toBe(!c.unavailable)
      expect(!!screen.queryByText('docs.forward.requestBotsRetry'), c.label).toBe(!c.unavailable)
      cleanup()
    }
  })

  // The escape hatch must actually submit — a dead-end page is the failure mode this whole state
  // exists to avoid, and "request for me only" is the ONLY way out when Retry keeps failing.
  it('submits a human-only request through the escape hatch when the Bot set stays unknown', async () => {
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/robot/owned_bots')) {
        throw { response: { status: 503 } }
      }
      return { data: {}, status: 201 }
    }
    render(<RequestAccessButton docId="d_1" spaceId="s_1" />)
    await waitFor(() => expect(screen.getByText('docs.forward.requestBotsError')).toBeTruthy())
    expect((screen.getByText('docs.forward.requestAccess').closest('button') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByText('docs.forward.requestSelfOnly'))
    await waitFor(() => expect(screen.getByText('docs.forward.accessRequested')).toBeTruthy())
    const post = wk.apiClient.calls.find((c) => c.method === 'post')!
    expect(post.url).toBe('/docs/d_1/access-requests')
    // Zero Bots → no body, the pre-feature request shape.
    expect(post.body).toBeUndefined()
  })

  it('lets the requester cancel a single Bot before submitting', async () => {
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/robot/owned_bots')) {
        return {
          data: [
            { uid: 'b_mine1', name: 'My Writer', creator_uid: 'u_self' },
            { uid: 'b_mine2', name: 'My Review', creator_uid: 'u_self' },
          ],
          status: 200,
        }
      }
      return { data: {}, status: 201 }
    }
    render(<RequestAccessButton docId="d_1" spaceId="s_1" />)
    await waitFor(() => expect(screen.getByText('My Review')).toBeTruthy())
    // Cancel the second Bot by toggling its checkbox.
    fireEvent.click(screen.getByText('My Review').closest('label')!.querySelector('input')!)
    fireEvent.click(screen.getByText('docs.forward.requestAccess'))
    await waitFor(() => expect(wk.apiClient.calls.some((c) => c.method === 'post')).toBe(true))
    const post = wk.apiClient.calls.find((c) => c.method === 'post')!
    expect(post.body).toEqual({ botUids: ['b_mine1'] })
  })

  it('does not show a Bot list and requests human-only (no body) when no spaceId is given', async () => {
    wk.apiClient.responder = () => ({ data: {}, status: 201 })
    render(<RequestAccessButton docId="d_1" />)
    // No space → ready immediately with a human-only request enabled.
    fireEvent.click(screen.getByText('docs.forward.requestAccess'))
    await waitFor(() => expect(wk.apiClient.calls.some((c) => c.method === 'post')).toBe(true))
    // No Bot lookup happened at all without a space.
    expect(wk.apiClient.calls.some((c) => c.url.startsWith('/robot/owned_bots'))).toBe(false)
    const post = wk.apiClient.calls.find((c) => c.method === 'post')!
    // Zero Bots → no body (legacy shape), never `{ botUids: [] }`.
    expect(post.body).toBeUndefined()
  })

  it('reloads Bots and drops the old set when spaceId changes, ignoring a stale response', async () => {
    let releaseS1: (v: unknown) => void = () => {}
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/robot/owned_bots')) {
        if (url.includes('s_1')) return new Promise((r) => (releaseS1 = r)) as never
        return { data: [{ uid: 'b_s2', name: 'S2 Bot', creator_uid: 'u_self' }], status: 200 }
      }
      return { data: {}, status: 201 }
    }
    const { rerender } = render(<RequestAccessButton docId="d_1" spaceId="s_1" />)
    // Switch space before s_1 resolves.
    rerender(<RequestAccessButton docId="d_1" spaceId="s_2" />)
    await waitFor(() => expect(screen.getByText('S2 Bot')).toBeTruthy())
    // The stale s_1 response arrives late — it must be ignored (no s_1 Bot appears).
    releaseS1({ data: [{ uid: 'b_s1', name: 'S1 Bot', creator_uid: 'u_self' }], status: 200 })
    await new Promise((r) => setTimeout(r, 5))
    expect(screen.queryByText('S1 Bot')).toBeNull()
    fireEvent.click(screen.getByText('docs.forward.requestAccess'))
    await waitFor(() => expect(wk.apiClient.calls.some((c) => c.method === 'post')).toBe(true))
    const post = wk.apiClient.calls.find((c) => c.method === 'post')!
    expect(post.body).toEqual({ botUids: ['b_s2'] })
  })

  it('resets the submit state when the document (docId) switches', async () => {
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/robot/owned_bots')) return { data: [], status: 200 }
      return { data: {}, status: 201 }
    }
    const { rerender } = render(<RequestAccessButton docId="d_1" spaceId="s_1" />)
    await waitFor(() => {
      const b = screen.getByText('docs.forward.requestAccess').closest('button') as HTMLButtonElement
      expect(b.disabled).toBe(false)
    })
    // Submit for d_1 → collapses to the disabled "submitted" state.
    fireEvent.click(screen.getByText('docs.forward.requestAccess'))
    await waitFor(() => expect(screen.getByText('docs.forward.accessRequested')).toBeTruthy())
    // Reuse the component for a new doc — the stale "submitted" state must NOT carry over.
    rerender(<RequestAccessButton docId="d_2" spaceId="s_1" />)
    await waitFor(() => expect(screen.getByText('docs.forward.requestAccess')).toBeTruthy())
    expect(screen.queryByText('docs.forward.accessRequested')).toBeNull()
  })

  it('drops a stale in-flight submit for the previous doc so it cannot overwrite the new doc state', async () => {
    let releaseD1: (v: unknown) => void = () => {}
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/robot/owned_bots')) return { data: [], status: 200 }
      if (method === 'post' && url.includes('/docs/d_1/')) {
        return new Promise((r) => (releaseD1 = r)) as never
      }
      return { data: {}, status: 201 }
    }
    const { rerender } = render(<RequestAccessButton docId="d_1" spaceId="s_1" />)
    await waitFor(() => {
      const b = screen.getByText('docs.forward.requestAccess').closest('button') as HTMLButtonElement
      expect(b.disabled).toBe(false)
    })
    // Fire the d_1 submit (its POST hangs), then switch to d_2 before it resolves.
    fireEvent.click(screen.getByText('docs.forward.requestAccess'))
    rerender(<RequestAccessButton docId="d_2" spaceId="s_1" />)
    await waitFor(() => expect(screen.getByText('docs.forward.requestAccess')).toBeTruthy())
    // The stale d_1 POST now resolves as success — it must NOT flip d_2 into "submitted".
    await act(async () => {
      releaseD1({ data: {}, status: 201 })
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(screen.queryByText('docs.forward.accessRequested')).toBeNull()
    expect(screen.getByText('docs.forward.requestAccess')).toBeTruthy()
  })

  // Regression (P1): the stale-submit guard MUST fire in the same render the key changes, not in a
  // later effect. Here the switched-doc render and the stale resolve happen in ONE act() flush with
  // no effect pass between the prop change and the resolve — the render-derived key comparison
  // (not a useEffect) is what keeps B idle. An effect-based guard would race and lose.
  it('keeps the new doc idle even when the stale submit resolves before any effect flush', async () => {
    let releaseD1: (v: unknown) => void = () => {}
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/robot/owned_bots')) return { data: [], status: 200 }
      if (method === 'post' && url.includes('/docs/d_1/')) {
        return new Promise((r) => (releaseD1 = r)) as never
      }
      return { data: {}, status: 201 }
    }
    const { rerender } = render(<RequestAccessButton docId="d_1" spaceId="s_1" />)
    await waitFor(() => {
      const b = screen.getByText('docs.forward.requestAccess').closest('button') as HTMLButtonElement
      expect(b.disabled).toBe(false)
    })
    // d_1 submit fires (POST hangs).
    fireEvent.click(screen.getByText('docs.forward.requestAccess'))
    // Switch to d_2 AND resolve the stale d_1 POST inside the SAME act() — the resolve lands with no
    // gap for any post-switch effect to run first.
    await act(async () => {
      rerender(<RequestAccessButton docId="d_2" spaceId="s_1" />)
      releaseD1({ data: {}, status: 201 })
      await Promise.resolve()
    })
    // d_2 stays idle and submittable; the stale success wrote only d_1's key.
    expect(screen.queryByText('docs.forward.accessRequested')).toBeNull()
    const btn = screen.getByText('docs.forward.requestAccess').closest('button') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
  })

  // Same same-flush race, but the stale submit REJECTS (incl. a 409): it must not paint the new
  // doc's button into "error" or "submitted".
  it('keeps the new doc idle when a stale submit rejects (409 or error) before any effect flush', async () => {
    let rejectD1: (e: unknown) => void = () => {}
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/robot/owned_bots')) return { data: [], status: 200 }
      if (method === 'post' && url.includes('/docs/d_1/')) {
        return new Promise((_r, rej) => (rejectD1 = rej)) as never
      }
      return { data: {}, status: 201 }
    }
    const { rerender } = render(<RequestAccessButton docId="d_1" spaceId="s_1" />)
    await waitFor(() => {
      const b = screen.getByText('docs.forward.requestAccess').closest('button') as HTMLButtonElement
      expect(b.disabled).toBe(false)
    })
    fireEvent.click(screen.getByText('docs.forward.requestAccess'))
    await act(async () => {
      rerender(<RequestAccessButton docId="d_2" spaceId="s_1" />)
      // A stale 409 (would be "submitted") — must not leak onto d_2.
      rejectD1({ response: { status: 409 } })
      await Promise.resolve()
    })
    expect(screen.queryByText('docs.forward.accessRequested')).toBeNull()
    expect(screen.queryByText('docs.forward.requestFailed')).toBeNull()
    const btn = screen.getByText('docs.forward.requestAccess').closest('button') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
  })

  // A→B→A: the outer wrapper keys the inner on the doc surface, so returning to A remounts a FRESH
  // inner. A stale in-flight submit fired for the FIRST A mount lands on an unmounted tree; when it
  // resolves it must NOT paint the second A mount, which stays idle and independently submittable.
  it('A→B→A: a stale submit from the first A resolve does not pollute the re-entered A (still submittable)', async () => {
    let releaseA: (v: unknown) => void = () => {}
    let aPostCount = 0
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/robot/owned_bots')) return { data: [], status: 200 }
      if (method === 'post' && url.includes('/docs/d_a/')) {
        aPostCount++
        if (aPostCount === 1) return new Promise((r) => (releaseA = r)) as never
        return { data: {}, status: 201 }
      }
      return { data: {}, status: 201 }
    }
    const { rerender } = render(<RequestAccessButton docId="d_a" spaceId="s_1" />)
    await waitFor(() => {
      const b = screen.getByText('docs.forward.requestAccess').closest('button') as HTMLButtonElement
      expect(b.disabled).toBe(false)
    })
    // Fire A's submit (POST hangs), then A→B, then B→A (remounts a fresh inner).
    fireEvent.click(screen.getByText('docs.forward.requestAccess'))
    rerender(<RequestAccessButton docId="d_b" spaceId="s_1" />)
    await waitFor(() => expect(screen.getByText('docs.forward.requestAccess')).toBeTruthy())
    rerender(<RequestAccessButton docId="d_a" spaceId="s_1" />)
    await waitFor(() => {
      const b = screen.getByText('docs.forward.requestAccess').closest('button') as HTMLButtonElement
      expect(b.disabled).toBe(false)
    })
    // The first A's stale POST resolves as success — it hits the unmounted tree, not this A.
    await act(async () => {
      releaseA({ data: {}, status: 201 })
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(screen.queryByText('docs.forward.accessRequested')).toBeNull()
    const btn = screen.getByText('docs.forward.requestAccess').closest('button') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    // The re-entered A can submit again and reach "submitted".
    fireEvent.click(screen.getByText('docs.forward.requestAccess'))
    await waitFor(() => expect(screen.getByText('docs.forward.accessRequested')).toBeTruthy())
  })

  // A→B→A with the first A's submit REJECTING (incl. a 409): the stale reject must not paint the
  // re-entered A into "submitted"/"error", and A must still be freshly submittable.
  it('A→B→A: a stale reject/409 from the first A does not pollute the re-entered A, which can resubmit', async () => {
    let rejectA: (e: unknown) => void = () => {}
    let aPostCount = 0
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/robot/owned_bots')) return { data: [], status: 200 }
      if (method === 'post' && url.includes('/docs/d_a/')) {
        aPostCount++
        if (aPostCount === 1) return new Promise((_r, rej) => (rejectA = rej)) as never
        return { data: {}, status: 201 }
      }
      return { data: {}, status: 201 }
    }
    const { rerender } = render(<RequestAccessButton docId="d_a" spaceId="s_1" />)
    await waitFor(() => {
      const b = screen.getByText('docs.forward.requestAccess').closest('button') as HTMLButtonElement
      expect(b.disabled).toBe(false)
    })
    fireEvent.click(screen.getByText('docs.forward.requestAccess'))
    rerender(<RequestAccessButton docId="d_b" spaceId="s_1" />)
    await waitFor(() => expect(screen.getByText('docs.forward.requestAccess')).toBeTruthy())
    rerender(<RequestAccessButton docId="d_a" spaceId="s_1" />)
    await waitFor(() => {
      const b = screen.getByText('docs.forward.requestAccess').closest('button') as HTMLButtonElement
      expect(b.disabled).toBe(false)
    })
    // First A's stale POST rejects with a 409 (would be "submitted") — must not leak onto this A.
    await act(async () => {
      rejectA({ response: { status: 409 } })
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(screen.queryByText('docs.forward.accessRequested')).toBeNull()
    expect(screen.queryByText('docs.forward.requestFailed')).toBeNull()
    const btn = screen.getByText('docs.forward.requestAccess').closest('button') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    // The re-entered A submits cleanly.
    fireEvent.click(screen.getByText('docs.forward.requestAccess'))
    await waitFor(() => expect(screen.getByText('docs.forward.accessRequested')).toBeTruthy())
  })
})
