type HtmlSourceDiffWindow = Window & {
  __OCTO_HTML_SOURCE_DIFF_ENABLED__?: unknown
}

/** Runtime switch. Missing, malformed, and non-boolean values fail closed. */
export function isHtmlSourceDiffEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return (window as HtmlSourceDiffWindow).__OCTO_HTML_SOURCE_DIFF_ENABLED__ === true
}
