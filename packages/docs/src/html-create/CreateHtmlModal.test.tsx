import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CreateHtmlModal } from './CreateHtmlModal.tsx'
import { getCurrentUid } from '../octoweb/index.ts'

function response(data: Record<string, unknown>, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => ({ data }) }
}

function fill() {
  fireEvent.change(screen.getByLabelText('docs.list.htmlCreate.nameLabel'), { target: { value: 'A < B' } })
  fireEvent.change(screen.getByLabelText('docs.list.htmlCreate.requirementsLabel'), { target: { value: 'Add a chart' } })
}

describe('CreateHtmlModal direct publish', () => {
  beforeEach(() => {
    sessionStorage.clear()
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open') } })
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(10) })
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear() })

  it('does not expose a final prompt before the server returns a real doc_id', () => {
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} />)
    fill()
    expect(screen.queryByLabelText('docs.list.htmlCreate.promptLabel')).toBeNull()
    expect(sessionStorage.length).toBe(0)
  })

  it('persists a complete prompt only after success', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ slug: 'html-server', version: 1, registered: true, status: 'published', doc_id: 'd-real' }) as Response)
    const onCreated = vi.fn()
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={onCreated} />)
    fill()
    fireEvent.click(screen.getByText('docs.list.htmlCreate.create'))
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
    const prompt = sessionStorage.getItem(`octo.docs.htmlModifyPrompt:${getCurrentUid()}:space-1:d-real`)
    expect(prompt).toContain('doc_id：d-real')
    expect(prompt).toContain('slug：html-server')
    expect(prompt).toContain('HTML 名称：A < B')
    expect(prompt).toContain('修改需求：Add a chart')
  })

  it('locks submission while publishing and sends only one POST on double click', async () => {
    let resolve!: (value: Response | PromiseLike<Response>) => void
    vi.mocked(fetch).mockReturnValue(new Promise((done) => { resolve = done }) as Promise<Response>)
    const onCreated = vi.fn()
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={onCreated} />)
    fill()
    const submit = screen.getByText('docs.list.htmlCreate.create') as HTMLButtonElement
    fireEvent.click(submit)
    fireEvent.click(submit)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect((screen.getByText('docs.list.htmlCreate.creating') as HTMLButtonElement).disabled).toBe(true)
    resolve(response({ slug: 'html-a', version: 1, registered: true, status: 'published', doc_id: 'd-1' }) as Response)
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ kind: 'published', docId: 'd-1', slug: 'html-a', version: 1 }))
  })

  it('aborts and ignores an old request that resolves after switching Space', async () => {
    let resolve!: (value: Response | PromiseLike<Response>) => void
    vi.mocked(fetch).mockReturnValue(new Promise((done) => { resolve = done }) as Promise<Response>)
    const onCreated = vi.fn()
    const view = render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={onCreated} />)
    fill()
    fireEvent.click(screen.getByText('docs.list.htmlCreate.create'))
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal
    view.rerender(<CreateHtmlModal open spaceId="space-2" onClose={() => {}} onCreated={onCreated} />)
    expect(signal?.aborted).toBe(true)
    resolve(response({ slug: 'old-space', version: 1, registered: true, status: 'published', doc_id: 'old-doc' }) as Response)
    await Promise.resolve()
    expect(onCreated).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(`octo.docs.htmlModifyPrompt:${getCurrentUid()}:space-1:old-doc`)).toBeNull()
  })

  it('keeps the editable form after a publish failure', async () => {
    vi.mocked(fetch).mockResolvedValue(response({}, false) as Response)
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} />)
    fill()
    fireEvent.click(screen.getByText('docs.list.htmlCreate.create'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('docs.list.htmlCreate.publishFailed'))
    expect((screen.getByLabelText('docs.list.htmlCreate.nameLabel') as HTMLInputElement).value).toBe('A < B')
    expect((screen.getByText('docs.list.htmlCreate.create') as HTMLButtonElement).disabled).toBe(false)
  })

  it('makes registration_failed terminal and never POSTs v2', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ slug: 'html-a', version: 1, registered: false, status: 'registration_failed' }) as Response)
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} />)
    fill()
    fireEvent.click(screen.getByText('docs.list.htmlCreate.create'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('docs.list.htmlCreate.registrationFailed'))
    const submit = screen.getByText('docs.list.htmlCreate.create') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.click(submit)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
