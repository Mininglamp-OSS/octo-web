import { describe, it, expect } from 'vitest';
import SecretsService from '../../../Service/SecretsService';

describe('SecretsService.normalizeName', () => {
  it('trims, collapses spaces and lowercases', () => {
    expect(SecretsService.normalizeName('  My  Claude   Key ')).toBe('my claude key');
  });
  it('treats case-only differences as duplicates', () => {
    expect(SecretsService.normalizeName('Claude')).toBe(
      SecretsService.normalizeName('claude')
    );
  });
  it('handles CJK names without stripping characters', () => {
    expect(SecretsService.normalizeName('我的 Claude 密钥')).toBe('我的 claude 密钥');
  });
});

describe('SecretsService.maskFromLast4', () => {
  it('builds a masked string from last4', () => {
    expect(SecretsService.maskFromLast4('a1b2')).toBe('••••a1b2');
  });
  it('falls back to a generic mask when last4 missing', () => {
    expect(SecretsService.maskFromLast4()).toBe('••••••••');
    expect(SecretsService.maskFromLast4('')).toBe('••••••••');
  });
});

describe('SecretsService.normalizeList', () => {
  it('returns [] for null/undefined', () => {
    expect(SecretsService.normalizeList(null)).toEqual([]);
    expect(SecretsService.normalizeList(undefined)).toEqual([]);
  });

  it('reads secrets/list/items envelopes and bare arrays', () => {
    const item = {
      secret_id: 'id1',
      display_name: 'Claude',
      kind: 'llm' as const,
      last4: 'wxyz',
      created_at: '2026-01-01T00:00:00Z',
    };
    expect(SecretsService.normalizeList({ secrets: [item] })[0].secret_id).toBe('id1');
    expect(SecretsService.normalizeList({ list: [item] })[0].secret_id).toBe('id1');
    expect(SecretsService.normalizeList({ items: [item] })[0].secret_id).toBe('id1');
    expect(SecretsService.normalizeList([item])[0].secret_id).toBe('id1');
  });

  it('derives masked from last4 when backend omits masked', () => {
    const out = SecretsService.normalizeList([
      {
        secret_id: 'id1',
        display_name: 'Claude',
        kind: 'llm',
        last4: 'wxyz',
        created_at: '2026-01-01T00:00:00Z',
      },
    ]);
    expect(out[0].masked).toBe('••••wxyz');
  });

  it('keeps backend-provided masked as-is', () => {
    const out = SecretsService.normalizeList([
      {
        secret_id: 'id1',
        display_name: 'Claude',
        kind: 'llm',
        masked: 'sk-****abcd',
        last4: 'abcd',
        created_at: '2026-01-01T00:00:00Z',
      },
    ]);
    expect(out[0].masked).toBe('sk-****abcd');
  });
});
