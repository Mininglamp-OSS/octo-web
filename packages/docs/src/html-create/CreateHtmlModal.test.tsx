import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CreateHtmlModal } from './CreateHtmlModal.tsx'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'

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
    const wk = createMockWKApp()
    wk.apiClient.responder = () => ({ data: [{ uid: 'bot-1', name: 'Builder' }, { uid: 'bot-2', name: 'Reviewer' }], status: 200 })
    setWKApp(wk)
  })

  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear() })

  it('keeps direct creation and Bot creation in one accessible workflow-card group', async () => {
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} onSubmit={() => {}} />)
    const choices = screen.getByRole('radiogroup', { name: 'docs.list.htmlCreate.modeLabel' })
    const direct = screen.getByRole('radio', { name: /docs.list.htmlCreate.modeDirect/ })
    const bot = screen.getByRole('radio', { name: /docs.list.htmlCreate.modeBot/ })
    expect(choices).toContain(direct)
    expect(direct).toBeInstanceOf(HTMLInputElement)
    expect(bot).toBeInstanceOf(HTMLInputElement)
    expect((direct as HTMLInputElement).type).toBe('radio')
    expect((direct as HTMLInputElement).name).toBe((bot as HTMLInputElement).name)
    expect((direct as HTMLInputElement).checked).toBe(true)
    expect((bot as HTMLInputElement).checked).toBe(false)
    expect(direct.closest('label')?.className).toContain('octo-html-create-mode-card')
    expect(screen.getByText('docs.list.htmlCreate.modeDirectDescription')).toBeTruthy()
    expect(screen.getByText('docs.list.htmlCreate.modeBotDescription')).toBeTruthy()
    fireEvent.click(bot)
    expect((direct as HTMLInputElement).checked).toBe(false)
    expect((bot as HTMLInputElement).checked).toBe(true)
    await waitFor(() => expect(screen.getByText('Builder')).toBeTruthy())
    expect(screen.getByLabelText('docs.list.htmlCreate.descLabel')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('docs.list.htmlCreate.descLabel'), { target: { value: 'Build a page' } })
    fireEvent.click(screen.getByText('docs.list.htmlCreate.generatePrompt'))
    expect(screen.getByLabelText('docs.list.htmlCreate.botPromptLabel')).toBeTruthy()
    expect(screen.queryByLabelText('docs.list.htmlCreate.promptLabel')).toBeNull()
  })

  it('uses a dedicated single-line style for the HTML name input', () => {
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} />)
    const nameInput = screen.getByLabelText('docs.list.htmlCreate.nameLabel')
    expect(nameInput).toBeInstanceOf(HTMLInputElement)
    expect(nameInput.className).toContain('octo-html-create-input')
  })

  it('closes from the accessible header close button when idle', () => {
    const onClose = vi.fn()
    render(<CreateHtmlModal open spaceId="space-1" onClose={onClose} onCreated={() => {}} />)

    const close = screen.getByRole('button', { name: 'docs.list.htmlCreate.close' })
    expect(close.className).toContain('octo-html-create-close')
    fireEvent.click(close)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('disables the header close button and does not close while publishing', () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}) as Promise<Response>)
    const onClose = vi.fn()
    render(<CreateHtmlModal open spaceId="space-1" onClose={onClose} onCreated={() => {}} />)
    fill()
    fireEvent.click(screen.getByText('docs.list.htmlCreate.create'))

    const close = screen.getByRole('button', { name: 'docs.list.htmlCreate.close' }) as HTMLButtonElement
    expect(close.disabled).toBe(true)
    fireEvent.click(close)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('clears an old copy notice when switching mode or returning to Bot editing', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: /docs.list.htmlCreate.modeBot/ }))
    await waitFor(() => expect(screen.getByText('Builder')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('docs.list.htmlCreate.descLabel'), { target: { value: 'Build a page' } })
    fireEvent.click(screen.getByText('docs.list.htmlCreate.generatePrompt'))
    fireEvent.click(screen.getByText('docs.list.htmlCreate.copyPrompt'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('docs.list.htmlCreate.copySuccess'))

    fireEvent.click(screen.getByRole('radio', { name: /docs.list.htmlCreate.modeDirect/ }))
    expect(screen.queryByText('docs.list.htmlCreate.copySuccess')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: /docs.list.htmlCreate.modeBot/ }))
    fireEvent.click(screen.getByText('docs.list.htmlCreate.copyPrompt'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('docs.list.htmlCreate.copySuccess'))
    fireEvent.click(screen.getByText('docs.list.htmlCreate.backToEdit'))
    fireEvent.click(screen.getByText('docs.list.htmlCreate.generatePrompt'))
    expect(screen.queryByText('docs.list.htmlCreate.copySuccess')).toBeNull()
  })

  it('clears an old copy notice after description, file, or Bot selection changes', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: /docs.list.htmlCreate.modeBot/ }))
    await waitFor(() => expect(screen.getByText('Reviewer')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('docs.list.htmlCreate.descLabel'), { target: { value: 'Build a page' } })

    const copyThenEdit = async () => {
      fireEvent.click(screen.getByText('docs.list.htmlCreate.generatePrompt'))
      fireEvent.click(screen.getByText('docs.list.htmlCreate.copyPrompt'))
      await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
      fireEvent.click(screen.getByText('docs.list.htmlCreate.backToEdit'))
    }

    await copyThenEdit()
    fireEvent.change(screen.getByLabelText('docs.list.htmlCreate.descLabel'), { target: { value: 'Build another page' } })
    fireEvent.click(screen.getByText('docs.list.htmlCreate.generatePrompt'))
    expect(screen.queryByText('docs.list.htmlCreate.copySuccess')).toBeNull()
    fireEvent.click(screen.getByText('docs.list.htmlCreate.backToEdit'))

    await copyThenEdit()
    fireEvent.click(screen.getByLabelText('Reviewer'))
    fireEvent.click(screen.getByText('docs.list.htmlCreate.generatePrompt'))
    expect(screen.queryByText('docs.list.htmlCreate.copySuccess')).toBeNull()
    fireEvent.click(screen.getByText('docs.list.htmlCreate.backToEdit'))

    await copyThenEdit()
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'brief.txt')] } })
    fireEvent.click(screen.getByText('docs.list.htmlCreate.generatePrompt'))
    expect(screen.queryByText('docs.list.htmlCreate.copySuccess')).toBeNull()
  })

  it('restores Bot validation accessibility and file-row styling hooks', async () => {
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} />)
    fireEvent.click(screen.getByText('docs.list.htmlCreate.modeBot'))
    await waitFor(() => expect(screen.getByText('Builder')).toBeTruthy())

    const description = screen.getByLabelText('docs.list.htmlCreate.descLabel') as HTMLTextAreaElement
    fireEvent.change(description, { target: { value: 'x'.repeat(8001) } })
    const error = screen.getByRole('alert')
    expect(description.getAttribute('aria-invalid')).toBe('true')
    expect(description.getAttribute('aria-describedby')).toBe(error.id)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'brief.txt')] } })
    expect(screen.getByText('brief.txt').className).toContain('octo-html-create-file-name')
    expect(screen.getByLabelText('docs.list.htmlCreate.removeFile').className).toContain('octo-html-create-file-remove')
  })

  it('forwards a Bot preview only once on a double click', async () => {
    const onSubmit = vi.fn()
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('radio', { name: /docs.list.htmlCreate.modeBot/ }))
    await waitFor(() => expect(screen.getByText('Builder')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('docs.list.htmlCreate.descLabel'), { target: { value: 'Build a page' } })
    fireEvent.click(screen.getByText('docs.list.htmlCreate.generatePrompt'))

    const forward = screen.getByText('docs.list.htmlCreate.forwardToBot') as HTMLButtonElement
    fireEvent.click(forward)
    fireEvent.click(forward)

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(forward.disabled).toBe(true)
  })

  it('previews a non-copyable comment prompt, then keeps a real-id success state until opened', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    vi.mocked(fetch).mockResolvedValue(response({ slug: 'html-server', version: 1, registered: true, status: 'published', doc_id: 'd-real' }) as Response)
    const onCreated = vi.fn()
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={onCreated} onSubmit={() => {}} />)
    fill()
    const precreatePrompt = (screen.getByLabelText('docs.list.htmlCreate.promptLabel') as HTMLTextAreaElement).value
    expect(precreatePrompt).not.toContain('doc_id')
    expect(precreatePrompt).toContain('docs.list.htmlCreate.precreatePrompt')
    expect(screen.getByText('docs.list.htmlCreate.directPromptHelp')).toBeTruthy()
    expect(screen.queryByText('docs.list.htmlCreate.copyPrompt')).toBeNull()
    expect(writeText).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('docs.list.htmlCreate.create'))
    await waitFor(() => expect(screen.getByText('docs.list.htmlCreate.directSuccess')).toBeTruthy())
    const prompt = (screen.getByLabelText('docs.list.htmlCreate.promptLabel') as HTMLTextAreaElement).value
    expect(prompt).toContain('doc_id：d-real')
    expect(prompt).toContain('slug：html-server')
    expect(onCreated).not.toHaveBeenCalled()
    const copyAndOpen = screen.getByText('docs.list.htmlCreate.copyPromptAndOpen')
    expect(copyAndOpen).toBeTruthy()
    fireEvent.click(copyAndOpen)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(prompt))
    expect(onCreated).toHaveBeenCalledWith({ kind: 'published', docId: 'd-real', slug: 'html-server', version: 1 })
  })

  it('does not expose real identifiers before the server returns them', () => {
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} />)
    fill()
    expect((screen.getByLabelText('docs.list.htmlCreate.promptLabel') as HTMLTextAreaElement).value).not.toContain('doc_id')
    expect(sessionStorage.length).toBe(0)
  })

  it('shows a complete prompt only after success without opening automatically', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ slug: 'html-server', version: 1, registered: true, status: 'published', doc_id: 'd-real' }) as Response)
    const onCreated = vi.fn()
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={onCreated} />)
    fill()
    fireEvent.click(screen.getByText('docs.list.htmlCreate.create'))
    await waitFor(() => expect(screen.getByText('docs.list.htmlCreate.directSuccess')).toBeTruthy())
    const prompt = (screen.getByLabelText('docs.list.htmlCreate.promptLabel') as HTMLTextAreaElement).value
    expect(prompt).toContain('doc_id：d-real')
    expect(prompt).toContain('slug：html-server')
    expect(prompt).toContain('HTML 名称：A < B')
    expect(prompt).toContain('修改需求：Add a chart')
    expect(onCreated).not.toHaveBeenCalled()
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
    await waitFor(() => expect(screen.getByText('docs.list.htmlCreate.directSuccess')).toBeTruthy())
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('locks both mode buttons while direct publishing and cannot switch to Bot', async () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}) as Promise<Response>)
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} />)
    fill()
    fireEvent.click(screen.getByText('docs.list.htmlCreate.create'))

    const directMode = screen.getByRole('radio', { name: /docs.list.htmlCreate.modeDirect/ }) as HTMLInputElement
    const botMode = screen.getByRole('radio', { name: /docs.list.htmlCreate.modeBot/ }) as HTMLInputElement
    expect(directMode.disabled).toBe(true)
    expect(botMode.disabled).toBe(true)
    expect(screen.getByLabelText('docs.list.htmlCreate.nameLabel')).toBeTruthy()
    expect(screen.queryByLabelText('docs.list.htmlCreate.descLabel')).toBeNull()
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
    expect(sessionStorage.length).toBe(0)
  })

  it('keeps the editable form and allows retry after an explicit HTTP publish failure', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({}, false) as Response)
      .mockResolvedValueOnce(response({ slug: 'html-a', version: 1, registered: true, status: 'published', doc_id: 'd-1' }) as Response)
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} />)
    fill()
    fireEvent.click(screen.getByText('docs.list.htmlCreate.create'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('docs.list.htmlCreate.publishFailed'))
    expect((screen.getByLabelText('docs.list.htmlCreate.nameLabel') as HTMLInputElement).value).toBe('A < B')
    const submit = screen.getByText('docs.list.htmlCreate.create') as HTMLButtonElement
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    await waitFor(() => expect(screen.getByText('docs.list.htmlCreate.directSuccess')).toBeTruthy())
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('locks submission after a network rejection because the publish result is uncertain', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('network unavailable'))
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} />)
    fill()
    fireEvent.click(screen.getByText('docs.list.htmlCreate.create'))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('docs.list.htmlCreate.publishUncertain'))
    const submit = screen.getByText('docs.list.htmlCreate.create') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.click(submit)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('locks submission after an invalid 2xx response because the publish result is uncertain', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ slug: 'html-a', version: 1, registered: true, status: 'published' }) as Response)
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} />)
    fill()
    fireEvent.click(screen.getByText('docs.list.htmlCreate.create'))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('docs.list.htmlCreate.publishUncertain'))
    const submit = screen.getByText('docs.list.htmlCreate.create') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.click(submit)
    expect(fetch).toHaveBeenCalledTimes(1)
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
