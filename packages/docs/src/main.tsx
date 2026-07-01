import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setWKApp } from './octoweb/index.ts'
import { createMockWKApp } from './octoweb/mock.ts'
import { DocsModule } from './module.tsx'
import { App } from './App.tsx'

// Standalone bootstrap.
//
// In real octo-web you would `import { WKApp } from 'dmworkbase'` (the real singleton) and add
// ONE line in apps/web/src/index.tsx: `WKApp.shared.registerModule(new DocsModule())`.
// Here we inject a mock WKApp so the app runs without the octo-web monorepo present. The mock's
// apiClient returns a dev collab-token (admin) so the editor mounts; the WS will retry against
// the configured endpoint (offline-first rendering still works from IndexedDB).
const wk = createMockWKApp({ uid: 'u_dev', token: 'dev-octo-session-token' })
wk.apiClient.responder = (_method, url) => {
  if (url === '/docs/collab-token') {
    return {
      data: {
        token: 'dev-collab-jwt',
        expiresAt: Date.now() + 5 * 60_000,
        role: 'admin',
        permission_epoch: 1,
        // Dev collab WS runs on its own origin (:1234) — mirror the backend contract so the
        // runtime WS-URL path is exercised in local dev instead of the build-time env fallback.
        collabWsUrl: 'ws://localhost:1234',
      },
      status: 200,
    }
  }
  if (url.endsWith('/members')) return { data: { items: [] }, status: 200 }
  if (url.endsWith('/invites')) return { data: { items: [] }, status: 200 }
  return { data: {}, status: 200 }
}
setWKApp(wk)

// Register the docs module exactly as octo-web would.
wk.shared.registerModule(new DocsModule())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App routes={wk.route.routes} />
  </StrictMode>,
)
