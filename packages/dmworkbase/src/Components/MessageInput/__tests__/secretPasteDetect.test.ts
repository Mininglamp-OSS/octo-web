import { describe, it, expect, vi } from 'vitest';
import { detectPastedSecret, handleSecretPaste } from '../secretPasteDetect';

describe('detectPastedSecret', () => {
  it('detects sk- prefixed keys', () => {
    const hit = detectPastedSecret('sk-abcdefghijklmnop');
    expect(hit).not.toBeNull();
    expect(hit?.prefix).toBe('sk-');
    expect(hit?.value).toBe('sk-abcdefghijklmnop');
  });

  it('detects bf- and app- prefixes', () => {
    expect(detectPastedSecret('bf-1234567890abcdef')?.prefix).toBe('bf-');
    expect(detectPastedSecret('app-1234567890abcdef')?.prefix).toBe('app-');
  });

  it('detects a key embedded in surrounding text', () => {
    const hit = detectPastedSecret('here is my key sk-ABCDEFGHIJKLMNOP please');
    expect(hit?.value).toBe('sk-ABCDEFGHIJKLMNOP');
  });

  it('ignores short non-key tokens like app-store', () => {
    expect(detectPastedSecret('app-store')).toBeNull();
    expect(detectPastedSecret('sk-short')).toBeNull();
  });

  it('detects keys in .env assignment lines', () => {
    expect(detectPastedSecret('OPENAI_API_KEY=sk-ABCDEFGHIJKLMNOP')?.value).toBe(
      'sk-ABCDEFGHIJKLMNOP'
    );
  });

  it('detects keys inside JSON values', () => {
    expect(detectPastedSecret('{"api_key":"sk-ABCDEFGHIJKLMNOP"}')?.value).toBe(
      'sk-ABCDEFGHIJKLMNOP'
    );
  });

  it('does not misfire on identifier-embedded prefixes like myapp-token', () => {
    expect(detectPastedSecret('myapp-tokenABCDEFGHIJKL')).toBeNull();
  });

  it('returns null for plain text and empty input', () => {
    expect(detectPastedSecret('just a normal message')).toBeNull();
    expect(detectPastedSecret('')).toBeNull();
  });
});

describe('handleSecretPaste (P0-1 hard-block contract)', () => {
  it('blocks the paste and notifies when a secret is detected', () => {
    const onDetected = vi.fn();
    // Returning true is the signal for handlePaste to preventDefault + return
    // true, so the plaintext never enters the editor (and thus can never be
    // sent). This is the regression guard for: paste secret → Enter → onSend.
    const blocked = handleSecretPaste('sk-ABCDEFGHIJKLMNOP', onDetected);
    expect(blocked).toBe(true);
    expect(onDetected).toHaveBeenCalledWith('sk-ABCDEFGHIJKLMNOP');
  });

  it('blocks secrets embedded in .env / JSON shaped pastes', () => {
    const onDetected = vi.fn();
    expect(
      handleSecretPaste('OPENAI_API_KEY=sk-ABCDEFGHIJKLMNOP', onDetected)
    ).toBe(true);
    expect(
      handleSecretPaste('{"api_key":"sk-ABCDEFGHIJKLMNOP"}', onDetected)
    ).toBe(true);
    expect(onDetected).toHaveBeenCalledTimes(2);
  });

  it('does NOT block normal text (paste proceeds, nothing notified)', () => {
    const onDetected = vi.fn();
    const blocked = handleSecretPaste('just a normal message', onDetected);
    expect(blocked).toBe(false);
    expect(onDetected).not.toHaveBeenCalled();
  });

  it('does NOT block short non-key tokens like app-store', () => {
    const onDetected = vi.fn();
    expect(handleSecretPaste('app-store', onDetected)).toBe(false);
    expect(onDetected).not.toHaveBeenCalled();
  });
});

/**
 * End-to-end intent: paste a secret → guard hard-blocks → plaintext never lands
 * in the editor → a subsequent send (which reads editor text) cannot carry it
 * into chat. We model the ProseMirror handlePaste contract used in index.tsx:
 * when handleSecretPaste returns true the host calls event.preventDefault() and
 * skips the default insert, so the editor buffer stays whatever it was before.
 */
describe('paste secret → Enter cannot send the key (P0-1 regression)', () => {
  it('keeps the editor empty so onSend never receives the pasted key', () => {
    // Simulated editor buffer + send path.
    let editorText = '';
    const onSend = vi.fn();
    let defaultPrevented = false;

    // Mirror of index.tsx handlePaste: default paste appends to the editor only
    // when NOT blocked.
    const simulatePaste = (clipboard: string) => {
      const blocked = handleSecretPaste(clipboard, () => {});
      if (blocked) {
        defaultPrevented = true;
        return; // preventDefault + return true → no default insert
      }
      editorText += clipboard; // default ProseMirror insert
    };
    const simulateEnter = () => {
      if (editorText.trim().length > 0) onSend(editorText);
    };

    simulatePaste('sk-ABCDEFGHIJKLMNOP');
    simulateEnter();

    expect(defaultPrevented).toBe(true);
    expect(editorText).toBe(''); // plaintext never entered the editor
    expect(onSend).not.toHaveBeenCalled(); // and thus cannot be sent
  });
});
