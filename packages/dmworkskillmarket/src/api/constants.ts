/**
 * API base URL for the skill marketplace backend.
 *
 * In development, Vite proxies `/market/api/v1` to the backend at :8092.
 * In production, nginx handles the same rewrite.
 *
 * Override with the VITE_SKILL_MARKET_API_BASE environment variable if needed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const meta = (import.meta as any) ?? {};
export const API_BASE_URL: string =
  meta.env?.VITE_SKILL_MARKET_API_BASE || "/market/api/v1";
