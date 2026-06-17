// Last-write-wins async guard for version preview loading (#4 §1.4 / Steve review).
//
// A slow preview response for an earlier-selected version must never overwrite the
// preview/diff of a later-selected version: the admin could otherwise see #A's
// content under a "Preview #B" header and restore the wrong version (adjacent to
// the restore red line). This guard issues a monotonic token per request and only
// lets the LATEST request apply its result.

export interface PreviewGuard {
  /**
   * Begin a new preview request. Returns an `isCurrent()` predicate that is true
   * only while this is still the most recent request. Call it after each `await`
   * (after the fetch resolves AND in the catch) and bail if it returns false.
   */
  begin(): { isCurrent: () => boolean }
}

/** Create a fresh last-write-wins guard (one per panel instance / useRef). */
export function createPreviewGuard(): PreviewGuard {
  let latest = 0
  return {
    begin() {
      const token = ++latest
      return { isCurrent: () => token === latest }
    },
  }
}
