import { resolveOctoDocBase } from '../html/htmlDocFrameHelpers.ts'
import { getWKApp } from '../octoweb/index.ts'

export interface BlankHtmlInput {
  name: string
  requirements: string
  spaceId: string
  slug?: string
  signal?: AbortSignal
  timeoutMs?: number
}

export type BlankHtmlResult =
  | { kind: 'published'; docId: string; slug: string; version: number }
  | { kind: 'registration_failed'; slug: string; version: number }

export type HtmlPublishOutcome = 'not_published' | 'uncertain'

const DEFINITELY_NOT_PUBLISHED_STATUSES = new Set([400, 401, 403, 404, 405, 413, 422, 501])
export const HTML_PUBLISH_TIMEOUT_MS = 60_000

/** Distinguishes a safe-to-retry HTTP rejection from a POST whose result is unknown. */
export class HtmlPublishError extends Error {
  readonly outcome: HtmlPublishOutcome

  constructor(outcome: HtmlPublishOutcome, message: string) {
    super(message)
    this.name = 'HtmlPublishError'
    this.outcome = outcome
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]!)
}

export function buildBlankHtml(title: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body></body></html>`
}

export function createUnpredictableSlug(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return `html-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export function buildModifyHtmlPrompt(input: { docId: string; name: string; requirements: string; slug: string }): string {
  return [
    '评论任务：请基于当前 HTML，使用 octo-html skill 按以下要求修改。',
    `doc_id：${input.docId}`,
    `HTML 名称：${input.name.trim()}`,
    `slug：${input.slug}`,
    `修改需求：${input.requirements.trim() || '请根据后续指令修改。'}`,
    '请先读取当前最新版本并沿用当前文档；发布时继续使用同一 doc_id 和 slug，不要新建 HTML。',
  ].join('\n')
}


function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export async function createBlankHtml(input: BlankHtmlInput): Promise<BlankHtmlResult> {
  const slug = input.slug || createUnpredictableSlug()
  const token = getWKApp().loginInfo?.token
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort(input.signal?.reason)
  input.signal?.addEventListener('abort', abortFromCaller, { once: true })
  if (input.signal?.aborted) abortFromCaller()
  let rejectOnAbort!: (error: HtmlPublishError) => void
  const aborted = new Promise<never>((_resolve, reject) => { rejectOnAbort = reject })
  const rejectAborted = () => rejectOnAbort(new HtmlPublishError('uncertain', 'publish request result is uncertain'))
  controller.signal.addEventListener('abort', rejectAborted, { once: true })
  if (controller.signal.aborted) rejectAborted()
  const timeout = setTimeout(
    () => controller.abort(new DOMException('publish timed out', 'TimeoutError')),
    input.timeoutMs ?? HTML_PUBLISH_TIMEOUT_MS,
  )
  try {
    const publish = (async (): Promise<BlankHtmlResult> => {
      let res: Response
      try {
        res = await fetch(`${resolveOctoDocBase()}/v1/docs`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(token ? { token } : {}),
          },
          body: JSON.stringify({
            slug,
            html: buildBlankHtml(input.name.trim()),
            title: input.name.trim(),
            meta: { title: input.name.trim() },
            mount_type: 'space',
            space_id: input.spaceId,
          }),
          signal: controller.signal,
        })
      } catch {
        throw new HtmlPublishError('uncertain', 'publish request result is uncertain')
      }
      if (!res.ok) {
        const outcome: HtmlPublishOutcome = DEFINITELY_NOT_PUBLISHED_STATUSES.has(res.status) ? 'not_published' : 'uncertain'
        throw new HtmlPublishError(outcome, `publish failed: ${res.status}`)
      }
      let payload: unknown
      try {
        payload = await res.json()
      } catch {
        throw new HtmlPublishError('uncertain', 'publish response could not be read')
      }
      const envelope = record(payload)
      const data = record(envelope?.data ?? envelope)
      if (!data || typeof data.slug !== 'string' || !data.slug || !Number.isInteger(data.version)) {
        throw new HtmlPublishError('uncertain', 'invalid publish response')
      }
      if (data.registered === false && data.status === 'registration_failed') {
        return { kind: 'registration_failed', slug: data.slug, version: data.version as number }
      }
      if (data.registered !== true || data.status !== 'published' || typeof data.doc_id !== 'string' || !data.doc_id) {
        throw new HtmlPublishError('uncertain', 'invalid publish response')
      }
      return { kind: 'published', docId: data.doc_id, slug: data.slug, version: data.version as number }
    })()
    // Response body readers do not consistently reject when fetch's signal is aborted.
    // Racing the full publish pipeline guarantees a bounded, handled settlement.
    return await Promise.race([publish, aborted])
  } finally {
    clearTimeout(timeout)
    controller.signal.removeEventListener('abort', rejectAborted)
    input.signal?.removeEventListener('abort', abortFromCaller)
  }
}
