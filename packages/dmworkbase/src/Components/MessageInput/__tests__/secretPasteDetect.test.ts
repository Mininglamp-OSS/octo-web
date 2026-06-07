import { describe, it, expect } from 'vitest';
import { detectPastedSecret } from '../secretPasteDetect';

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
