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

  it('unwraps a data envelope (P0-2): { data: { secrets } } and { data: [] }', () => {
    const item = {
      secret_id: 'id1',
      display_name: 'Claude',
      kind: 'llm' as const,
      last4: 'wxyz',
      created_at: '2026-01-01T00:00:00Z',
    };
    // YUJ-3538 ships bare { secrets: [...] }; these guard against a gateway /
    // middleware later wrapping the body in a `data` envelope so the list does
    // not silently normalize to [].
    expect(
      SecretsService.normalizeList({ data: { secrets: [item] } })[0].secret_id
    ).toBe('id1');
    expect(SecretsService.normalizeList({ data: [item] })[0].secret_id).toBe('id1');
    expect(SecretsService.normalizeList({ data: { list: [item] } })[0].secret_id).toBe(
      'id1'
    );
  });

  it('still derives masked through the data envelope', () => {
    const out = SecretsService.normalizeList({
      data: {
        secrets: [
          {
            secret_id: 'id1',
            display_name: 'Claude',
            kind: 'llm',
            last4: 'wxyz',
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
      },
    });
    expect(out[0].masked).toBe('••••wxyz');
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

  it('drops any leaked plaintext/secret fields via explicit whitelist (P0-2)', () => {
    // 后端回归 / 未来字段变动可能误带明文。normalizer 必须只挑 write-only 契约
    // 允许的字段，绝不 `...it` 透传，否则明文会进 React state 被 Sentry/devtool 泄漏。
    const dirty = {
      secret_id: 'id1',
      display_name: 'Claude',
      kind: 'llm' as const,
      last4: 'wxyz',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      last_used_at: '2026-01-03T00:00:00Z',
      // 以下都是绝不该出现在前端的字段（构造后端回归场景）：
      value: 'sk-supersecret-plaintext-value',
      plaintext: 'sk-supersecret-plaintext-value',
      ciphertext: 'enc:deadbeef',
      key: 'sk-supersecret-plaintext-value',
      secret_value: 'sk-supersecret-plaintext-value',
    };
    const out = SecretsService.normalizeList([dirty as never]);
    const item = out[0];
    // 允许字段都在。
    expect(item.secret_id).toBe('id1');
    expect(item.display_name).toBe('Claude');
    expect(item.kind).toBe('llm');
    expect(item.last4).toBe('wxyz');
    expect(item.created_at).toBe('2026-01-01T00:00:00Z');
    expect(item.updated_at).toBe('2026-01-02T00:00:00Z');
    expect(item.last_used_at).toBe('2026-01-03T00:00:00Z');
    expect(item.masked).toBe('••••wxyz');
    // 泄漏字段一个都不能进。
    const leaked = item as Record<string, unknown>;
    expect(leaked.value).toBeUndefined();
    expect(leaked.plaintext).toBeUndefined();
    expect(leaked.ciphertext).toBeUndefined();
    expect(leaked.key).toBeUndefined();
    expect(leaked.secret_value).toBeUndefined();
    // 兜底：序列化整个项也绝不含明文（模拟误 JSON.stringify(state) 泄漏路径）。
    expect(JSON.stringify(item)).not.toContain('supersecret');
    // 输出键集合就是白名单本身。
    expect(Object.keys(item).sort()).toEqual(
      ['created_at', 'display_name', 'kind', 'last4', 'last_used_at', 'masked', 'secret_id', 'updated_at'].sort()
    );
  });

  it('keeps last_used_at: null (never used) but omits absent optionals', () => {
    const out = SecretsService.normalizeList([
      {
        secret_id: 'id1',
        display_name: 'Claude',
        kind: 'llm',
        last4: 'wxyz',
        created_at: '2026-01-01T00:00:00Z',
        last_used_at: null,
      },
    ]);
    const item = out[0];
    expect(item.last_used_at).toBeNull();
    // 没传 updated_at / 没回 masked 之外，键集合不应含 updated_at。
    expect(Object.prototype.hasOwnProperty.call(item, 'updated_at')).toBe(false);
  });
});
