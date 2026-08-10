import { resolveOctoDocBase } from '../html/htmlDocFrameHelpers.ts'
import { getCurrentUid, getWKApp } from '../octoweb/index.ts'

export interface BlankHtmlInput {
  name: string
  requirements: string
  spaceId: string
  slug?: string
  signal?: AbortSignal
}

export type BlankHtmlResult =
  | { kind: 'published'; docId: string; slug: string; version: number }
  | { kind: 'registration_failed'; slug: string; version: number }

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
    '请使用 octo-html skill 修改当前 HTML。',
    `doc_id：${input.docId}`,
    `HTML 名称：${input.name.trim()}`,
    `slug：${input.slug}`,
    `修改需求：${input.requirements.trim() || '请根据后续指令修改。'}`,
    '先读取当前最新版本，在其基础上修改；发布时沿用同一 doc_id 和 slug，不要创建新的 HTML。',
  ].join('\n')
}

const MODIFY_PROMPT_PREFIX = 'octo.docs.htmlModifyPrompt:'

function modifyPromptKey(spaceId: string, docId: string): string {
  return `${MODIFY_PROMPT_PREFIX}${getCurrentUid()}:${spaceId}:${docId}`
}

export function persistModifyHtmlPrompt(spaceId: string, docId: string, prompt: string): void {
  try {
    sessionStorage.setItem(modifyPromptKey(spaceId, docId), prompt)
  } catch {
    // The newly opened document remains usable when storage is unavailable.
  }
}

export function readModifyHtmlPrompt(spaceId: string, docId: string): string | null {
  try {
    return sessionStorage.getItem(modifyPromptKey(spaceId, docId))
  } catch {
    return null
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export async function createBlankHtml(input: BlankHtmlInput): Promise<BlankHtmlResult> {
  const slug = input.slug || createUnpredictableSlug()
  const token = getWKApp().loginInfo?.token
  const res = await fetch(`${resolveOctoDocBase()}/v1/docs`, {
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
    signal: input.signal,
  })
  if (!res.ok) throw new Error(`publish failed: ${res.status}`)
  const envelope = record(await res.json())
  const data = record(envelope?.data ?? envelope)
  if (!data || typeof data.slug !== 'string' || !data.slug || !Number.isInteger(data.version)) {
    throw new Error('invalid publish response')
  }
  if (data.registered === false && data.status === 'registration_failed') {
    return { kind: 'registration_failed', slug: data.slug, version: data.version as number }
  }
  if (data.registered !== true || data.status !== 'published' || typeof data.doc_id !== 'string' || !data.doc_id) {
    throw new Error('invalid publish response')
  }
  return { kind: 'published', docId: data.doc_id, slug: data.slug, version: data.version as number }
}
