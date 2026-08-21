/**
 * Pure decision for the shell window's setWindowOpenHandler: only http(s)
 * URLs are handed to the system browser. Everything else (file://, custom
 * schemes like octo://, javascript:, …) is denied WITHOUT openExternal — an
 * attacker-chosen protocol string must never reach the OS handler registry.
 */
export function isExternalHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
