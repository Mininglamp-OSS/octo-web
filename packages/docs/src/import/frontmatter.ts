// YAML front-matter stripping for Markdown import (design §7).
//
// We do NOT do a full YAML parse — only strip a leading `---\n…\n---` block and best-effort
// extract a `title:` line. Everything else in the front matter is discarded (v1). This keeps
// the import safe (no arbitrary YAML type coercion) and matches the design's degrade policy.

export interface FrontMatter {
  title?: string
}

export interface StripResult {
  body: string
  frontMatter: FrontMatter
}

const FM_RE = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/**
 * If the input begins with a `---` fenced YAML block, remove it and pull out a `title:` value.
 * Otherwise return the input unchanged with an empty front matter.
 */
export function stripFrontMatter(input: string): StripResult {
  const m = FM_RE.exec(input)
  if (!m) return { body: input, frontMatter: {} }

  const yaml = m[1]
  const fm: FrontMatter = {}
  // Best-effort: match a top-level `title: value` (quoted or bare), first occurrence.
  const titleMatch = /^title:\s*(.+?)\s*$/m.exec(yaml)
  if (titleMatch) {
    fm.title = titleMatch[1].replace(/^["']|["']$/g, '').trim()
  }
  return { body: input.slice(m[0].length), frontMatter: fm }
}
