import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeToClipboard } from '../clipboard';

describe('writeToClipboard', () => {
  const originalClipboard = navigator.clipboard;
  const originalIsSecure = (window as unknown as { isSecureContext?: boolean }).isSecureContext;
  let execCommandMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    execCommandMock = vi.fn().mockReturnValue(true);
    document.execCommand = execCommandMock as unknown as typeof document.execCommand;
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
    Object.defineProperty(window, 'isSecureContext', { value: originalIsSecure, configurable: true });
    vi.restoreAllMocks();
  });

  it('uses navigator.clipboard.writeText when available in a secure context', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });

    const ok = await writeToClipboard('hello');

    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(execCommandMock).not.toHaveBeenCalled();
  });

  it('falls back to execCommand when isSecureContext is false (plain HTTP LAN deployment)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });

    const ok = await writeToClipboard('http-fallback');

    expect(ok).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
    expect(execCommandMock).toHaveBeenCalledWith('copy');
  });

  it('falls back to execCommand when navigator.clipboard is undefined entirely', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });

    const ok = await writeToClipboard('no-clipboard-api');

    expect(ok).toBe(true);
    expect(execCommandMock).toHaveBeenCalledWith('copy');
  });

  it('falls back to execCommand when navigator.clipboard.writeText rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });

    const ok = await writeToClipboard('rejected');

    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalled();
    expect(execCommandMock).toHaveBeenCalledWith('copy');
  });

  it('returns false when both paths fail (execCommand returns false)', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    execCommandMock.mockReturnValue(false);

    const ok = await writeToClipboard('total-fail');

    expect(ok).toBe(false);
  });

  it('removes the temporary textarea from the DOM after copy', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });

    const before = document.querySelectorAll('textarea').length;
    await writeToClipboard('cleanup-check');
    const after = document.querySelectorAll('textarea').length;

    expect(after).toBe(before);
  });
});
