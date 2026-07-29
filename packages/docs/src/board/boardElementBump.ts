/**
 * boardElementBump — CAS stamp helpers for Excalidraw element mutations.
 *
 * Increment CAS stamp (version + versionNonce) so a mutation propagates through the
 * binding.handleLocalChange CAS gate (elementSupersedes: higher version wins; equal
 * version → smaller versionNonce wins). Without bumping, a shallow-copied mutation
 * keeps the previous stamp and is silently rejected by the gate — the local scene
 * shows the change, but no peer sees it and a reload reverts it (the "silent-drop"
 * class of bug: `telemetry.casRejected` ticks up while `localWrites` stays flat).
 *
 * Excalidraw itself uses its internal `randomInteger()` for `versionNonce`; that
 * helper is not exported from the public entry, so we use a bounded random uint32
 * (2^31 - 1) — this matches the value range Excalidraw and the whiteboard schema
 * both accept while staying inside a Number.MAX_SAFE_INTEGER-safe window.
 */

/** Random `versionNonce` in [0, 2^31). Used as the CAS tie-breaker at equal `version`. */
export function nextVersionNonce(): number {
  return Math.floor(Math.random() * 0x7fffffff)
}

/**
 * Return a new element object whose `version` is incremented and `versionNonce` is refreshed.
 *
 * Usage note (ORDER MATTERS): put field mutations INSIDE the spread — call as
 * `bumpElementStamp({ ...el, fontSize: px })`, not `{ ...bumpElementStamp(el), fontSize: px }`
 * (the latter is fine, but a common pitfall is to spread AFTER bumping and accidentally clobber
 * the fresh `version`/`versionNonce` with stale fields).
 */
export function bumpElementStamp<T extends Record<string, unknown> & { version?: number; versionNonce?: number }>(
  el: T,
): T {
  return {
    ...el,
    version: (typeof el.version === 'number' ? el.version : 0) + 1,
    versionNonce: nextVersionNonce(),
  }
}
