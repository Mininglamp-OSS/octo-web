/**
 * Cross-context clipboard write.
 *
 * `navigator.clipboard.writeText` is ONLY available in "secure contexts"
 * (HTTPS or http://localhost). Over plain HTTP on a LAN IP — which is the
 * default for on-prem OCTO deployments (http://<vm-lan-ip>:28080/) — the
 * whole `navigator.clipboard` object is undefined and any call throws
 * silently through optional chaining. That's the reason "复制链接" appeared
 * to do nothing on the deployed VM.
 *
 * Fallback: legacy `document.execCommand('copy')` via a temporary textarea.
 * It's deprecated but still supported by every browser we ship, and it
 * DOES work in insecure contexts. Selecting hidden text is fiddly — the
 * element must actually be in the DOM and visible enough for selection,
 * which is why we use fixed positioning off-screen with a non-zero opacity.
 */
export async function writeToClipboard(text: string): Promise<boolean> {
  // Secure context: prefer the modern API.
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Some browsers throw NotAllowedError even in a secure context if the
      // page hasn't been interacted with recently; fall through to legacy.
    }
  }
  // Legacy fallback that works over HTTP.
  if (typeof document === 'undefined') return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  // Off-screen but still selectable. `display: none` would prevent select().
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.width = '2em';
  ta.style.height = '2em';
  ta.style.padding = '0';
  ta.style.border = 'none';
  ta.style.outline = 'none';
  ta.style.boxShadow = 'none';
  ta.style.background = 'transparent';
  ta.style.opacity = '0';
  ta.setAttribute('readonly', '');
  document.body.appendChild(ta);
  try {
    ta.focus();
    ta.select();
    // execCommand returns a boolean; a false is a benign "not supported here".
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
  }
}
