import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CreateHtmlModal } from './CreateHtmlModal.tsx'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import { buildHtmlCreationMessage } from './createHtmlTask.ts'

function response(data: Record<string, unknown>, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: async () => ({ data }) }
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
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} onSubmit={() => {}} />)
    const nameInput = screen.getByLabelText('docs.list.htmlCreate.nameLabel')
    expect(nameInput).toBeInstanceOf(HTMLInputElement)
    expect(nameInput.className).toContain('octo-html-create-input')
    expect((nameInput as HTMLInputElement).maxLength).toBe(512)
    expect((screen.getByLabelText('docs.list.htmlCreate.requirementsLabel') as HTMLTextAreaElement).maxLength).toBe(8000)
  })

  it('loads Bots only after Bot mode is entered and preserves a non-first selection', async () => {
    const wk = createMockWKApp()
    const responder = vi.fn(() => ({ data: [{ uid: 'bot-1', name: 'Builder' }, { uid: 'bot-2', name: 'Reviewer' }], status: 200 }))
    wk.apiClient.responder = responder
    setWKApp(wk)
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} onSubmit={() => {}} />)
    await act(async () => {})
    expect(responder).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('radio', { name: /docs.list.htmlCreate.modeBot/ }))
    await waitFor(() => expect(screen.getByText('Reviewer')).toBeTruthy())
    expect(responder).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByLabelText('Reviewer'))
    fireEvent.click(screen.getByRole('radio', { name: /docs.list.htmlCreate.modeDirect/ }))
    fireEvent.click(screen.getByRole('radio', { name: /docs.list.htmlCreate.modeBot/ }))
    expect((screen.getByLabelText('Reviewer') as HTMLInputElement).checked).toBe(true)
  })

  it('loads the new Space after Bots are ready and ignores stale Space state', async () => {
    const wk = createMockWKApp()
    let resolveSpace2!: (value: { data: Array<{ uid: string; name: string }>; status: number }) => void
    wk.apiClient.responder = (_method, url) => {
      if (url.includes('space-1')) return { data: [{ uid: 'bot-1', name: 'Space One Bot' }], status: 200 }
      if (url.includes('space-2')) return new Promise((resolve) => { resolveSpace2 = resolve })
      return { data: [], status: 200 }
    }
    setWKApp(wk)
    const view = render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} onSubmit={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: /docs.list.htmlCreate.modeBot/ }))
    await waitFor(() => expect(screen.getByText('Space One Bot')).toBeTruthy())
    expect((screen.getByLabelText('Space One Bot') as HTMLInputElement).checked).toBe(true)

    view.rerender(<CreateHtmlModal open spaceId="space-2" onClose={() => {}} onCreated={() => {}} onSubmit={() => {}} />)
    expect(screen.queryByText('Space One Bot')).toBeNull()
    expect(screen.getByText('docs.list.htmlCreate.botLoading')).toBeTruthy()
    await waitFor(() => expect(resolveSpace2).toBeTypeOf('function'))
    resolveSpace2({ data: [{ uid: 'bot-2', name: 'Space Two Bot' }], status: 200 })
    await waitFor(() => expect(screen.getByText('Space Two Bot')).toBeTruthy())
    expect((screen.getByLabelText('Space Two Bot') as HTMLInputElement).checked).toBe(true)

    const calls = wk.apiClient.calls.filter((call) => call.url.startsWith('/robot/owned_bots'))
    expect(calls.map((call) => call.url)).toEqual([
      '/robot/owned_bots?space_id=space-1',
      '/robot/owned_bots?space_id=space-2',
    ])
  })

  it('does not let a late Bot response from the old Space overwrite the current Space', async () => {
    const wk = createMockWKApp()
    let resolveOld!: (value: { data: Array<{ uid: string; name: string }>; status: number }) => void
    wk.apiClient.responder = (_method, url) => url.includes('space-1')
      ? new Promise((resolve) => { resolveOld = resolve })
      : { data: [{ uid: 'bot-2', name: 'Current Space Bot' }], status: 200 }
    setWKApp(wk)
    const view = render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} onSubmit={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: /docs.list.htmlCreate.modeBot/ }))
    await waitFor(() => expect(resolveOld).toBeTypeOf('function'))

    view.rerender(<CreateHtmlModal open spaceId="space-2" onClose={() => {}} onCreated={() => {}} onSubmit={() => {}} />)
    await waitFor(() => expect(screen.getByText('Current Space Bot')).toBeTruthy())
    resolveOld({ data: [{ uid: 'bot-1', name: 'Stale Space Bot' }], status: 200 })
    await act(async () => {})

    expect(screen.queryByText('Stale Space Bot')).toBeNull()
    expect((screen.getByLabelText('Current Space Bot') as HTMLInputElement).checked).toBe(true)
  })

  it('closes from the accessible header close button when idle', () => {
    const onClose = vi.fn()
    render(<CreateHtmlModal open spaceId="space-1" onClose={onClose} onCreated={() => {}} onSubmit={() => {}} />)

    const close = screen.getByRole('button', { name: 'docs.list.htmlCreate.close' })
    expect(close.className).toContain('octo-html-create-close')
    fireEvent.click(close)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('disables the header close button and does not close while publishing', () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}) as Promise<Response>)
    const onClose = vi.fn()
    render(<CreateHtmlModal open spaceId="space-1" onClose={onClose} onCreated={() => {}} onSubmit={() => {}} />)
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
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} onSubmit={() => {}} />)
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
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} onSubmit={() => {}} />)
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
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} onSubmit={() => {}} />)
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

  it('keeps one non-empty request id across preview, copy, edit and forwarding', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const onSubmit = vi.fn()
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('radio', { name: /docs.list.htmlCreate.modeBot/ }))
    await waitFor(() => expect(screen.getByText('Builder')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('docs.list.htmlCreate.descLabel'), { target: { value: 'Build a page' } })
    fireEvent.click(screen.getByText('docs.list.htmlCreate.generatePrompt'))
    const first = (screen.getByLabelText('docs.list.htmlCreate.botPromptLabel') as HTMLTextAreaElement).value
    const requestId = first.match(/^request_id: (.+)$/m)?.[1]
    expect(requestId).toBeTruthy()
    fireEvent.click(screen.getByText('docs.list.htmlCreate.copyPrompt'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(first))
    fireEvent.click(screen.getByText('docs.list.htmlCreate.backToEdit'))
    fireEvent.change(screen.getByLabelText('docs.list.htmlCreate.descLabel'), { target: { value: 'Changed page' } })
    fireEvent.click(screen.getByText('docs.list.htmlCreate.generatePrompt'))
    expect((screen.getByLabelText('docs.list.htmlCreate.botPromptLabel') as HTMLTextAreaElement).value).toContain(`request_id: ${requestId}`)
    fireEvent.click(screen.getByText('docs.list.htmlCreate.forwardToBot'))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ requestId }))
  })

  it('allows a real final message exactly at the 5000-character boundary', async () => {
    const requestId = '123e4567-e89b-12d3-a456-426614174000'
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => requestId), getRandomValues: (bytes: Uint8Array) => bytes.fill(1) })
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} onSubmit={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: /docs.list.htmlCreate.modeBot/ }))
    await waitFor(() => expect(screen.getByText('Builder')).toBeTruthy())
    const fixed = buildHtmlCreationMessage({ requestId, botUid: 'bot-1', botName: '', description: '', files: [], spaceId: 'space-1', baseUrl: '' }).length
    fireEvent.change(screen.getByLabelText('docs.list.htmlCreate.descLabel'), { target: { value: 'x'.repeat(5000 - fixed) } })
    expect((screen.getByText('docs.list.htmlCreate.generatePrompt') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByText('docs.list.htmlCreate.generatePrompt'))
    expect((screen.getByLabelText('docs.list.htmlCreate.botPromptLabel') as HTMLTextAreaElement).value).toHaveLength(5000)
  })

  it('blocks a real final message at 5001 characters with a 36-character UUID', async () => {
    const requestId = '123e4567-e89b-12d3-a456-426614174000'
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => requestId), getRandomValues: (bytes: Uint8Array) => bytes.fill(1) })
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} onSubmit={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: /docs.list.htmlCreate.modeBot/ }))
    await waitFor(() => expect(screen.getByText('Builder')).toBeTruthy())
    const fixed = buildHtmlCreationMessage({ requestId, botUid: 'bot-1', botName: '', description: '', files: [], spaceId: 'space-1', baseUrl: '' }).length
    fireEvent.change(screen.getByLabelText('docs.list.htmlCreate.descLabel'), { target: { value: 'x'.repeat(5001 - fixed) } })
    expect((screen.getByText('docs.list.htmlCreate.generatePrompt') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toBe('docs.list.htmlCreate.messageTooLong')
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
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} onSubmit={() => {}} />)
    fill()
    expect((screen.getByLabelText('docs.list.htmlCreate.promptLabel') as HTMLTextAreaElement).value).not.toContain('doc_id')
    expect(sessionStorage.length).toBe(0)
  })

  it('shows a complete prompt only after success without opening automatically', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ slug: 'html-server', version: 1, registered: true, status: 'published', doc_id: 'd-real' }) as Response)
    const onCreated = vi.fn()
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={onCreated} onSubmit={() => {}} />)
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
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={onCreated} onSubmit={() => {}} />)
    fill()
    const submit = screen.getByText('docs.list.htmlCreate.create') as HTMLButtonElement
    const form = submit.closest('form')!
    act(() => { fireEvent.submit(form); fireEvent.submit(form) })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect((screen.getByText('docs.list.htmlCreate.creating') as HTMLButtonElement).disabled).toBe(true)
    resolve(response({ slug: 'html-a', version: 1, registered: true, status: 'published', doc_id: 'd-1' }) as Response)
    await waitFor(() => expect(screen.getByText('docs.list.htmlCreate.directSuccess')).toBeTruthy())
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('locks both mode buttons while direct publishing and cannot switch to Bot', async () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}) as Promise<Response>)
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} onSubmit={() => {}} />)
    fill()
    fireEvent.click(screen.getByText('docs.list.htmlCreate.create'))

    const directMode = screen.getByRole('radio', { name: /docs.list.htmlCreate.modeDirect/ }) as HTMLInputElement
    const botMode = screen.getByRole('radio', { name: /docs.list.htmlCreate.modeBot/ }) as HTMLInputElement
    expect(directMode.disabled).toBe(true)
    expect(botMode.disabled).toBe(true)
    expect(screen.getByLabelText('docs.list.htmlCreate.nameLabel')).toBeTruthy()
    expect(screen.queryByLabelText('docs.list.htmlCreate.descLabel')).toBeNull()
  })

  it('times out after headers when response JSON hangs, reports uncertain, and unlocks closing', async () => {
    vi.useFakeTimers()
    const signalSeen = vi.fn()
    vi.mocked(fetch).mockImplementation((_url, init) => {
      signalSeen(init?.signal)
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => new Promise(() => {}),
      } as Response)
    })
    const onClose = vi.fn()
    render(<CreateHtmlModal open spaceId="space-1" onClose={onClose} onCreated={() => {}} onSubmit={() => {}} />)
    fill()
    fireEvent.click(screen.getByText('docs.list.htmlCreate.create'))
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(signalSeen).toHaveBeenCalledTimes(1)
    expect((signalSeen.mock.calls[0][0] as AbortSignal).aborted).toBe(true)
    expect(screen.getByRole('alert').textContent).toBe('docs.list.htmlCreate.publishUncertain')
    const close = screen.getByRole('button', { name: 'docs.list.htmlCreate.close' }) as HTMLButtonElement
    expect(close.disabled).toBe(false)
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('aborts and ignores an old request that resolves after switching Space', async () => {
    let resolve!: (value: Response | PromiseLike<Response>) => void
    vi.mocked(fetch).mockReturnValue(new Promise((done) => { resolve = done }) as Promise<Response>)
    const onCreated = vi.fn()
    const view = render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={onCreated} onSubmit={() => {}} />)
    fill()
    fireEvent.click(screen.getByText('docs.list.htmlCreate.create'))
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal
    view.rerender(<CreateHtmlModal open spaceId="space-2" onClose={() => {}} onCreated={onCreated} onSubmit={() => {}} />)
    expect(signal?.aborted).toBe(true)
    resolve(response({ slug: 'old-space', version: 1, registered: true, status: 'published', doc_id: 'old-doc' }) as Response)
    await Promise.resolve()
    expect(onCreated).not.toHaveBeenCalled()
    expect(sessionStorage.length).toBe(0)
  })

  it('does not open after copy completes in a different Space', async () => {
    let finish!: () => void
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(() => new Promise<void>((resolve) => { finish = resolve })) } })
    vi.mocked(fetch).mockResolvedValue(response({ slug: 'html-a', version: 1, registered: true, status: 'published', doc_id: 'd-1' }) as Response)
    const onCreated = vi.fn()
    const view = render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={onCreated} onSubmit={() => {}} />)
    fill()
    fireEvent.click(screen.getByText('docs.list.htmlCreate.create'))
    await waitFor(() => expect(screen.getByText('docs.list.htmlCreate.copyPromptAndOpen')).toBeTruthy())
    fireEvent.click(screen.getByText('docs.list.htmlCreate.copyPromptAndOpen'))
    view.rerender(<CreateHtmlModal open spaceId="space-2" onClose={() => {}} onCreated={onCreated} onSubmit={() => {}} />)
    finish()
    await Promise.resolve()
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('invalidates a pending clipboard open when the modal closes', async () => {
    let finish!: () => void
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(() => new Promise<void>((resolve) => { finish = resolve })) } })
    vi.mocked(fetch).mockResolvedValue(response({ slug: 'html-a', version: 1, registered: true, status: 'published', doc_id: 'd-1' }) as Response)
    const onCreated = vi.fn()
    const view = render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={onCreated} onSubmit={() => {}} />)
    fill()
    fireEvent.click(screen.getByText('docs.list.htmlCreate.create'))
    await waitFor(() => expect(screen.getByText('docs.list.htmlCreate.copyPromptAndOpen')).toBeTruthy())
    fireEvent.click(screen.getByText('docs.list.htmlCreate.copyPromptAndOpen'))
    view.rerender(<CreateHtmlModal open={false} spaceId="space-1" onClose={() => {}} onCreated={onCreated} onSubmit={() => {}} />)
    finish()
    await act(async () => {})
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('synchronously locks copy-and-open and direct-open across double/cross clicks', async () => {
    let finish!: () => void
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(() => new Promise<void>((resolve) => { finish = resolve })) } })
    vi.mocked(fetch).mockResolvedValue(response({ slug: 'html-a', version: 1, registered: true, status: 'published', doc_id: 'd-1' }) as Response)
    const onCreated = vi.fn()
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={onCreated} onSubmit={() => {}} />)
    fill()
    fireEvent.click(screen.getByText('docs.list.htmlCreate.create'))
    await waitFor(() => expect(screen.getByText('docs.list.htmlCreate.copyPromptAndOpen')).toBeTruthy())
    const copyAndOpen = screen.getByText('docs.list.htmlCreate.copyPromptAndOpen') as HTMLButtonElement
    const directOpen = screen.getByText('docs.list.htmlCreate.openDirectly') as HTMLButtonElement
    fireEvent.click(copyAndOpen)
    fireEvent.click(copyAndOpen)
    fireEvent.click(directOpen)
    expect(copyAndOpen.disabled).toBe(true)
    expect(directOpen.disabled).toBe(true)
    expect(onCreated).not.toHaveBeenCalled()
    finish()
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
  })

  it('keeps the editable form and allows retry after an explicit HTTP publish failure', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({}, false) as Response)
      .mockResolvedValueOnce(response({ slug: 'html-a', version: 1, registered: true, status: 'published', doc_id: 'd-1' }) as Response)
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} onSubmit={() => {}} />)
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
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} onSubmit={() => {}} />)
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
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} onSubmit={() => {}} />)
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
    render(<CreateHtmlModal open spaceId="space-1" onClose={() => {}} onCreated={() => {}} onSubmit={() => {}} />)
    fill()
    fireEvent.click(screen.getByText('docs.list.htmlCreate.create'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('docs.list.htmlCreate.registrationFailed'))
    const submit = screen.getByText('docs.list.htmlCreate.create') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.click(submit)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(screen.getByText('html-a')).toBeTruthy()
    expect(screen.getByText('docs.list.htmlCreate.copySlug')).toBeTruthy()
  })
})
