/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Optional at type level: Web env doesn't require it (uses /api/v1/ relative path)
  // Required at runtime for Tauri/Electron builds (enforced in index.tsx)
  readonly VITE_API_URL?: string
  readonly VITE_VERSION: string
  // Enables the enterprise SSO entry (OIDC) on the login page.
  // Open-source builds leave this unset to keep the entry hidden.
  readonly VITE_ENABLE_ENTERPRISE_SSO?: string
  // Dev-only override for OIDC logout callback when using a remote backend from localhost.
  readonly VITE_OIDC_POST_LOGOUT_REDIRECT_URI?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
