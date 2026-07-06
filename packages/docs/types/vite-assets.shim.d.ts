// Ambient declarations for Vite asset imports used by the docs package.
//
// WHY THIS EXISTS
// ---------------
// The PDF export module imports the Chinese font via Vite's `?url` suffix
// (`import fontUrl from './assets/NotoSansSC-Regular.ttf?url'`). Vite resolves
// this to the built asset URL at bundle time, but tsc has no knowledge of the
// `?url` query, so we declare it here for typecheck.

declare module '*?url' {
  const url: string
  export default url
}

declare module '*.ttf' {
  const url: string
  export default url
}

declare module '*?inline' {
  const content: string
  export default content
}
