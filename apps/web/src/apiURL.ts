export interface ApiURLOptions {
  isDesktop: boolean
  isDev: boolean
  rawApiURL?: string
}

export function resolveApiURL({ isDesktop, isDev, rawApiURL }: ApiURLOptions): string {
  if (!isDesktop || isDev) {
    return "/api/v1/"
  }

  if (!rawApiURL) {
    throw new Error(
      "VITE_API_URL is required for Tauri/Electron. Please set it in .env.local (e.g., VITE_API_URL=https://api.example.com)",
    )
  }

  let apiOrigin: string
  try {
    apiOrigin = new URL(rawApiURL).origin
  } catch {
    throw new Error(
      `VITE_API_URL format is invalid: "${rawApiURL}". Please use full URL, e.g. https://api.example.com`,
    )
  }

  return `${apiOrigin}/v1/`
}
