import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const modalUpdate = vi.hoisted(() => vi.fn())
const modalDestroy = vi.hoisted(() => vi.fn())

vi.mock('@douyinfe/semi-ui', () => ({
  Toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), close: vi.fn() },
  Modal: { info: vi.fn(() => ({ update: modalUpdate, destroy: modalDestroy })) },
  Progress: () => null,
  Button: 'button',
}))

vi.mock('../../App', () => ({
  default: {
    apiClient: {
      get: vi.fn(),
    },
  },
}))

const mockTrack = vi.fn()
vi.mock('../../Service/Dap', () => ({
  Dap: {
    shared: {
      track: (...args: unknown[]) => mockTrack(...args),
    },
  },
}))

// B-2:electron 下载状态由 desktopBridge 桥接。默认按浏览器路(isElectronPowered=false),
//   electron 测试里逐例改成 true 并注入捕获 IPC_DOWNLOAD_STATUS 监听器的假 bridge。
vi.mock('../../electron/desktopBridge', () => ({
  isElectronPowered: vi.fn(() => false),
  getElectronIpcBridge: vi.fn(() => null),
}))

import { downloadFile, getPresignedDownloadUrl, getPresignedPreviewUrl, classifyDownloadFileType, clampFileType, saveFileAs } from '../download'
import { openSaveProgressModal } from '../saveProgressModal'
import { Toast, Modal } from '@douyinfe/semi-ui'
import WKApp from '../../App'
import { isElectronPowered, getElectronIpcBridge } from '../../electron/desktopBridge'
import { IPC_DOWNLOAD_STATUS, IPC_DOWNLOAD_URL } from '../../../../../apps/web/src-election/shared/ipc-channels'

describe('downloadFile', () => {
  let capturedAnchor: HTMLAnchorElement | null = null

  beforeEach(() => {
    capturedAnchor = null
    vi.resetAllMocks()
    vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => {
      capturedAnchor = node as HTMLAnchorElement
      ;(node as HTMLAnchorElement).click = vi.fn()
      return node
    })
    vi.spyOn(document.body, 'removeChild').mockImplementation((node: Node) => node)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls presigned API for cross-origin URLs', async () => {
    vi.mocked(WKApp.apiClient.get).mockResolvedValue({ url: 'https://cdn.example.com/signed-url', filename: 'photo.png' })

    await downloadFile('https://cdn.example.com/image.png', 'photo.png')

    expect(WKApp.apiClient.get).toHaveBeenCalledWith(
      expect.stringContaining('file/download/url?path=')
    )
    expect(capturedAnchor).not.toBeNull()
    expect(capturedAnchor!.href).toBe('https://cdn.example.com/signed-url')
  })

  it('does not add response-content-disposition to cross-origin URLs', async () => {
    vi.mocked(WKApp.apiClient.get).mockResolvedValue({ url: 'https://cdn.example.com/signed', filename: 'photo.png' })

    await downloadFile('https://cdn.example.com/image.png', 'photo.png')

    expect(capturedAnchor).not.toBeNull()
    expect(capturedAnchor!.href).not.toContain('response-content-disposition')
  })

  it('falls back to original URL when presigned API fails', async () => {
    vi.mocked(WKApp.apiClient.get).mockRejectedValue(new Error('network'))

    await downloadFile('https://cdn.example.com/image.png', 'photo.png')

    expect(capturedAnchor).not.toBeNull()
    expect(capturedAnchor!.href).toBe('https://cdn.example.com/image.png')
  })

  it('does nothing for empty URL', async () => {
    await downloadFile('', 'photo.png')
    expect(capturedAnchor).toBeNull()
  })

  it('does nothing for javascript: URL', async () => {
    await downloadFile('javascript:alert(1)', 'photo.png')
    expect(capturedAnchor).toBeNull()
  })

  it('uses the original URL when the download helper returns no signed URL', async () => {
    vi.mocked(WKApp.apiClient.get).mockResolvedValue({})

    await expect(getPresignedDownloadUrl('/files/a.txt', 'a.txt')).resolves.toBe('/files/a.txt')
  })

  it('requests inline disposition for preview URLs', async () => {
    vi.mocked(WKApp.apiClient.get).mockResolvedValue({ url: 'https://cdn.example.com/preview' })

    await expect(getPresignedPreviewUrl('/files/a.pdf', 'a.pdf')).resolves.toBe('https://cdn.example.com/preview')
    expect(WKApp.apiClient.get).toHaveBeenCalledWith(
      'file/download/url?path=%2Ffiles%2Fa.pdf&filename=a.pdf&disposition=inline'
    )
  })

  it('downloads same-origin URLs without requesting a presigned URL', async () => {
    await downloadFile('/files/a.txt', 'a.txt')

    expect(WKApp.apiClient.get).not.toHaveBeenCalled()
    expect(capturedAnchor).not.toBeNull()
    expect(capturedAnchor!.href).toBe(`${window.location.origin}/files/a.txt`)
  })
})

describe('message_file_downloaded file_type privacy guard', () => {
  // 隐私红线:file_type 绝不透传用户可控的文件名正文,只能是已知扩展名白名单里的低基数枚举
  //   或 "other" / ""。参照本 PR 为模板事件加的 *_name 自由文本键守卫风格。
  const fileType = (name: string): string => classifyDownloadFileType(name)

  it('keeps known extensions and normalizes case', () => {
    expect(fileType('photo.PNG')).toBe('png')
    expect(fileType('report.pdf')).toBe('pdf')
    expect(fileType('sheet.XLSX')).toBe('xlsx')
  })

  it('clamps CJK / free-text suffixes to "other", never leaking the raw fragment', () => {
    for (const name of ['机密.客户并购项目', 'report.内部资料', '2026Q3财报.客户机密并购项目', 'a.superlongsuffixstring']) {
      const ext = fileType(name)
      expect(ext).toBe('other')
      // 绝不等于原始片段,且不含任何非 [a-z0-9] 字符
      const rawFragment = name.slice(name.lastIndexOf('.') + 1)
      expect(ext).not.toBe(rawFragment)
      expect(ext).toMatch(/^[a-z0-9]+$/)
    }
  })

  it('reports empty string when there is no extension', () => {
    expect(fileType('README')).toBe('')
    expect(fileType('.env')).toBe('')
    expect(fileType('report.')).toBe('')
  })

  it('emits the clamped file_type through Dap.shared.track on download', async () => {
    mockTrack.mockClear()
    await downloadFile('/files/机密.客户并购项目', '机密.客户并购项目')

    expect(mockTrack).toHaveBeenCalledWith('message_file_downloaded', { file_type: 'other' })
    const calls = mockTrack.mock.calls
    const props = calls[calls.length - 1][1] as { file_type: string }
    expect(props.file_type).not.toContain('客户')
  })
})

describe('message_file_downloaded electron completion semantics (B-2)', () => {
  // electron 路只在下载「完成」时计一次;取消/失败/过期都不计。
  let statusListener: ((event: unknown, ...args: unknown[]) => void) | null = null
  let invokeMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockTrack.mockClear()
    statusListener = null
    invokeMock = vi.fn().mockResolvedValue(undefined)
    vi.mocked(isElectronPowered).mockReturnValue(true)
    vi.mocked(getElectronIpcBridge).mockReturnValue({
      send: vi.fn(),
      once: vi.fn(),
      invoke: invokeMock as unknown as (channel: string, ...args: unknown[]) => Promise<unknown>,
      on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => {
        if (channel === IPC_DOWNLOAD_STATUS) statusListener = listener
      },
      removeListener: vi.fn(),
    })
  })

  afterEach(() => {
    vi.mocked(isElectronPowered).mockReturnValue(false)
    vi.mocked(getElectronIpcBridge).mockReturnValue(null)
  })

  // 从 invoke(IPC_DOWNLOAD_URL, url, filename, id) 拿到内部生成的 download id
  const invokedId = (): string => {
    const call = invokeMock.mock.calls.find((c) => c[0] === IPC_DOWNLOAD_URL)
    return (call?.[3] as string) ?? ''
  }

  it('emits once with clamped file_type only after status === completed', async () => {
    await downloadFile('/files/report.pdf', 'report.pdf')
    expect(mockTrack).not.toHaveBeenCalled() // 发起时不计
    expect(statusListener).not.toBeNull()

    statusListener!(null, { id: invokedId(), state: 'completed', filename: 'report.pdf' })
    expect(mockTrack).toHaveBeenCalledTimes(1)
    expect(mockTrack).toHaveBeenCalledWith('message_file_downloaded', { file_type: 'pdf' })
  })

  it('does NOT emit when status === failed', async () => {
    await downloadFile('/files/report.pdf', 'report.pdf')
    statusListener!(null, { id: invokedId(), state: 'failed', filename: 'report.pdf' })
    expect(mockTrack).not.toHaveBeenCalled()
  })

  it('does NOT emit when status === cancelled', async () => {
    await downloadFile('/files/report.pdf', 'report.pdf')
    statusListener!(null, { id: invokedId(), state: 'cancelled', filename: 'report.pdf' })
    expect(mockTrack).not.toHaveBeenCalled()
  })

  it('ignores status events for a different download id', async () => {
    await downloadFile('/files/report.pdf', 'report.pdf')
    statusListener!(null, { id: 'some-other-id', state: 'completed', filename: 'report.pdf' })
    expect(mockTrack).not.toHaveBeenCalled()
  })
})

describe('clampFileType privacy guard (shared clamp for structured FileContent.extension)', () => {
  // clampFileType 入参是「裸后缀」(FileContent.extension 本就无点),不做 lastIndexOf(".") 切分。
  //   message_file_saved_to_drive 直接拿它钳制 extension,与 message_file_downloaded 同口径。
  it('keeps clean bare extensions and normalizes case', () => {
    expect(clampFileType('pdf')).toBe('pdf')
    expect(clampFileType('PNG')).toBe('png')
    expect(clampFileType('  Xlsx  ')).toBe('xlsx')
  })

  it('does NOT misclassify a clean bare suffix as "" (the lastIndexOf-dot trap)', () => {
    // 结构化 extension 无点:若误用 classifyDownloadFileType 会因 lastDot<=0 返回 ""。
    //   clampFileType 不切点,pdf 应稳定命中白名单。
    expect(classifyDownloadFileType('pdf')).toBe('') // 反证陷阱:无点被 classify 判空
    expect(clampFileType('pdf')).toBe('pdf')          // clamp 才是正确处理裸后缀的入口
  })

  it('clamps CJK / free-text / oversized suffixes to "other", never leaking the raw fragment', () => {
    for (const raw of ['客户机密并购项目', '内部资料', 'aaaaaaaaaaaa', 'a b', 'tar.gz name']) {
      const ext = clampFileType(raw)
      expect(ext).toBe('other')
      expect(ext).not.toBe(raw)
      expect(ext).toMatch(/^[a-z0-9]+$/)
    }
  })

  it('reports empty string for empty / whitespace-only suffix', () => {
    expect(clampFileType('')).toBe('')
    expect(clampFileType('   ')).toBe('')
  })
})

describe('message_file_saved_to_drive source-level file_type guard', () => {
  // module.tsx 的 saveToDrive 成功回调没有独立可挂测的导出;用 source-level pin 守住
  //   「file_type 经 clampFileType 钳制、绝不直传原始 extension」这条隐私红线。
  const moduleSrc = readFileSync(
    resolve(__dirname, '../../module.tsx'),
    'utf8',
  )

  it('imports the shared clampFileType helper', () => {
    expect(moduleSrc).toMatch(/import\s*\{[^}]*\bclampFileType\b[^}]*\}\s*from\s*["']\.\/Utils\/download["']/)
  })

  it('clamps file_type at the message_file_saved_to_drive track site', () => {
    const idx = moduleSrc.indexOf('"message_file_saved_to_drive"')
    expect(idx).toBeGreaterThan(-1)
    const block = moduleSrc.slice(idx, idx + 400)
    // 钳制后的 file_type,绝不再出现「直传原始 extension」的旧形态
    expect(block).toMatch(/file_type:\s*clampFileType\(/)
    expect(block).not.toMatch(/file_type:\s*fileContent\?\.extension\s*\|\|\s*""/)
  })
})

describe('saveFileAs write progress (review: 大文件静默存储不友好)', () => {
  // 用一个受控 ReadableStream + 假 FileSystemWritableFileHandle 驱动 saveFileAs 的
  // Web 分支,断言:进度用 Toast.info 刷新、完成 Toast.success、失败降级 anchor 下载。
  const originalPicker = (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker
  let writtenChunks: Uint8Array[]
  let writable: { write: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn> }
  let capturedAnchor: HTMLAnchorElement | null
  let removeFile: ReturnType<typeof vi.fn>

  const makeStream = (chunks: Uint8Array[]): ReadableStream<Uint8Array> => {
    let i = 0
    return new ReadableStream<Uint8Array>({
      pull(ctrl) {
        if (i < chunks.length) ctrl.enqueue(chunks[i++])
        else ctrl.close()
      },
    })
  }

  const stubFetch = (chunks: Uint8Array[], total: number | null, ok = true) => {
    const headers = new Headers()
    if (total != null) headers.set('content-length', String(total))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      body: ok ? makeStream(chunks) : null,
      headers,
    }))
  }

  beforeEach(() => {
    vi.resetAllMocks()
    writtenChunks = []
    writable = {
      write: vi.fn(async (c: Uint8Array) => { writtenChunks.push(c) }),
      close: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
    }
    removeFile = vi.fn(async () => {})
    ;(globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker = vi.fn(async () => ({
      remove: removeFile,
      createWritable: async () => writable,
    }))
    capturedAnchor = null
    vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => {
      capturedAnchor = node as HTMLAnchorElement
      ;(node as HTMLAnchorElement).click = vi.fn()
      return node
    })
    vi.spyOn(document.body, 'removeChild').mockImplementation((node: Node) => node)
  })

  afterEach(() => {
    ;(globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker = originalPicker
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('streams chunks to the chosen handle, shows progress, then success', async () => {
    const chunks = [new Uint8Array(50), new Uint8Array(50)]
    stubFetch(chunks, 100)
    vi.mocked(WKApp.apiClient.get).mockResolvedValue({ url: 'https://cdn.example.com/signed', filename: 'big.bin' })

    await saveFileAs('https://cdn.example.com/big.bin', 'big.bin')

    // 进度期间创建并刷新居中 Modal,结束后进入完成态并自动销毁。
    expect(Modal.info).toHaveBeenCalled()
    expect(modalUpdate).toHaveBeenCalled()
    expect(writable.close).toHaveBeenCalledTimes(1)
  })

  it('falls back to anchor download when the write stream errors mid-way', async () => {
    // fetch 成功、进度 toast 已弹,但写入第二块时磁盘/权限错误 → streamToWritable
    // 关掉进度 toast 并抛错 → saveFileAs catch 走 downloadFile(anchor 降级)。
    const chunks = [new Uint8Array(50), new Uint8Array(50)]
    stubFetch(chunks, 100)
    writable.write = vi.fn()
      .mockImplementationOnce(async (c: Uint8Array) => { writtenChunks.push(c) })
      .mockRejectedValueOnce(new Error('disk full'))
    vi.mocked(WKApp.apiClient.get).mockResolvedValue({ url: 'https://cdn.example.com/signed', filename: 'big.bin' })

    await saveFileAs('https://cdn.example.com/big.bin', 'big.bin')

    // 进度 Modal 已创建又被关闭,且降级到 anchor(浏览器默认目录)。
    expect(Modal.info).toHaveBeenCalled()
    expect(modalDestroy).toHaveBeenCalled()
    expect(writable.abort).toHaveBeenCalled()
    expect(capturedAnchor).not.toBeNull()
  })

  it('falls back to anchor download when fetch fails before streaming', async () => {
    // fetch 非 2xx → 在弹进度 toast 前就抛错 → saveFileAs catch 直接 anchor 降级。
    stubFetch([], null, false)
    vi.mocked(WKApp.apiClient.get).mockResolvedValue({ url: 'https://cdn.example.com/signed', filename: 'big.bin' })

    await saveFileAs('https://cdn.example.com/big.bin', 'big.bin')

    expect(modalDestroy).toHaveBeenCalled()
    expect(Toast.error).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('保存到所选位置失败') }),
    )
    expect(capturedAnchor).not.toBeNull()
  })

  it('renders a cancel-save button and exposes cancellation control', () => {
    const controller = openSaveProgressModal('big.bin', false)
    const options = vi.mocked(Modal.info).mock.calls[0][0] as { content: any }
    const children = options.content.props.children as any[]
    const button = children.find((child: any) => child?.type === 'button')
    expect(button?.props.children).toBe('取消保存')
    expect(controller.cancel).toEqual(expect.any(Function))
    controller.close()
  })

  it('disables cancellation after completion is shown', () => {
    const controller = openSaveProgressModal('big.bin', false)
    controller.done()
    const calls = vi.mocked(modalUpdate).mock.calls
    const update = calls[calls.length - 1]?.[0] as { content: any }
    const button = (update.content.props.children as any[]).find((child: any) => child?.type === 'button')
    expect(button.props.disabled).toBe(true)
    controller.close()
  })

  it('uses one combined save-target line for label and filename', () => {
    openSaveProgressModal('big.bin', false)
    const options = vi.mocked(Modal.info).mock.calls[0][0] as { content: any }
    const target = (options.content.props.children as any[])[0]
    expect(target.props.className).toBe('wk-save-progress-target')
    expect(target.props.children[0].props.children).toContain('保存文件到')
    expect(target.props.children[1].props.children).toBe('big.bin')
  })

  it('cancels an active save without falling back to a second download', async () => {
    const chunks = [new Uint8Array(50), new Uint8Array(50)]
    stubFetch(chunks, 100)
    vi.mocked(WKApp.apiClient.get).mockResolvedValue({ url: 'https://cdn.example.com/signed', filename: 'big.bin' })
    let resolveWrite: (() => void) | undefined
    writable.write = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveWrite = resolve }))
      .mockResolvedValue(undefined)

    const savePromise = saveFileAs('https://cdn.example.com/big.bin', 'big.bin')
    await vi.waitFor(() => expect(Modal.info).toHaveBeenCalled())
    const modalOptions = vi.mocked(Modal.info).mock.calls[0][0] as { content: any }
    const button = (modalOptions.content.props.children as any[]).find((child: any) => child?.type === 'button')
    button.props.onClick()
    resolveWrite?.()
    await savePromise

    expect(capturedAnchor).toBeNull()
    expect(modalDestroy).toHaveBeenCalled()
    expect(removeFile).not.toHaveBeenCalled()
  })

  it('preserves an existing file handle on cancellation', async () => {
    stubFetch([new Uint8Array(10)], 10)
    ;(globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker = vi.fn(async () => ({
      remove: removeFile,
      createWritable: async () => writable,
    }))
    let resolveWrite: (() => void) | undefined
    writable.write = vi.fn(() => new Promise<void>((resolve) => { resolveWrite = resolve }))

    const savePromise = saveFileAs('/files/existing.bin', 'existing.bin')
    await vi.waitFor(() => expect(Modal.info).toHaveBeenCalled())
    const modalOptions = vi.mocked(Modal.info).mock.calls[0][0] as { content: any }
    const button = (modalOptions.content.props.children as any[]).find((child: any) => child?.type === 'button')
    button.props.onClick()
    resolveWrite?.()
    await savePromise

    expect(removeFile).not.toHaveBeenCalled()
    expect(capturedAnchor).toBeNull()
  })

  it('keeps indeterminate progress animated until the response has no total', () => {
    openSaveProgressModal('unknown.bin', true)
    const options = vi.mocked(Modal.info).mock.calls[0][0] as { content: any }
    const children = options.content.props.children as any[]
    expect(children.some((child: any) => child?.props?.className === 'wk-save-progress-indeterminate')).toBe(true)
  })

  it('user cancel (AbortError) returns silently — no write, no toast', async () => {
    ;(globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker = vi.fn(async () => {
      const e = new Error('cancel'); e.name = 'AbortError'; throw e
    })
    stubFetch([new Uint8Array(10)], 10)

    await saveFileAs('https://cdn.example.com/big.bin', 'big.bin')

    expect(writable.write).not.toHaveBeenCalled()
    expect(Toast.info).not.toHaveBeenCalled()
    expect(Toast.success).not.toHaveBeenCalled()
  })
})
