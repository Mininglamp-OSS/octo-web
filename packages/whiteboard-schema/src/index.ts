/**
 * @octo/whiteboard-schema — frozen shared whiteboard schema package (XIN-16 §3).
 *
 * Single import surface for the three consumers that MUST share one definition:
 *   - front-end Excalidraw binding (XIN-25) — local normalize + key build/parse;
 *   - back-end authoritative repair (octo-docs-backend src/whiteboard/repair.ts);
 *   - back-end Agent conversion path (Element <-> Y.Map).
 *
 * This package is Yjs-free and framework-free on purpose, so the front-end can
 * import it directly and the back-end can vendor/depend on it without dragging
 * in Yjs. The Yjs Y.Map <-> element/file adapters live in the back-end only
 * (octo-docs-backend src/whiteboard/ydoc.ts), outside this shared source.
 */
export * from './constants.ts'
export * from './types.ts'
export * from './normalize.ts'
export * from './fileRef.ts'
export * from './name.ts'

