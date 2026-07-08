/**
 * SSRF-gating tests for the DOCX image collector.
 *
 * Raw image `src` values must pass through the same trust boundary the editor
 * enforces everywhere else (sanitizeAssetUrl: scheme + storage-host allowlist).
 * A scheme-only check would let a document embed src="http://169.254.169.254/…"
 * or an internal RFC1918 host and make the exporting user's browser fire a blind
 * SSRF beacon from their authenticated session. data: URLs have no network
 * egress and remain the legitimate inline-image case.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveAndFetchImages } from './images.ts'
import type { MdNode } from './types.ts'
import type { resolveAttachments } from '../../attachments/api.ts'

const noopResolve: typeof resolveAttachments = async () => ({ items: [], notFound: [] })

function imageDoc(src: string): MdNode {
  return { type: 'doc', content: [{ type: 'image', attrs: { src } }] } as MdNode
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveAndFetchImages — raw src SSRF gating', () => {
  it('does NOT fetch a non-allowlisted http host (internal/SSRF target)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200 }),
    )
    await resolveAndFetchImages('d1', imageDoc('http://169.254.169.254/latest/meta-data'), {
      resolve: noopResolve,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does NOT fetch an arbitrary external host lacking allowlist entry', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200 }),
    )
    await resolveAndFetchImages('d1', imageDoc('https://evil.attacker.example/x.png'), {
      resolve: noopResolve,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('DOES fetch an allowlisted storage host', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200 }),
    )
    await resolveAndFetchImages('d1', imageDoc('https://assets.octo.example.com/img.png'), {
      resolve: noopResolve,
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(String(fetchSpy.mock.calls[0][0])).toContain('assets.octo.example.com')
  })

  it('DOES fetch a data: image (no network egress, inline case)', async () => {
    // data: still goes through the guarded fetch path; jsdom/undici handles data URLs.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200 }),
    )
    await resolveAndFetchImages(
      'd1',
      imageDoc('data:image/png;base64,iVBORw0KGgo='),
      { resolve: noopResolve },
    )
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/^data:image\/png/)
  })

  it('does NOT fetch file:/blob:/javascript: schemes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200 }),
    )
    for (const bad of ['file:///etc/passwd', 'blob:https://x/y', 'javascript:alert(1)']) {
      await resolveAndFetchImages('d1', imageDoc(bad), { resolve: noopResolve })
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
