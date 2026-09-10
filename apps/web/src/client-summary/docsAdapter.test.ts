// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fakeWKApp, ENDPOINT_IDS, API_ORIGIN } = vi.hoisted(() => {
  const methods: Record<string, { handler: (p: any, spaceId?: string) => any }> = {};
  return {
    API_ORIGIN: 'https://example.com',
    fakeWKApp: {
      shared: { currentSpaceId: 'space-42' },
      loginInfo: { uid: 'user-a', token: 'tok-a' },
      endpointManager: {
        _methods: methods,
        setMethod(sid: string, handler: (p: any, spaceId?: string) => any) {
          this._methods[sid] = { handler };
        },
        get(sid: string) { return this._methods[sid]; },
      },
    },
    ENDPOINT_IDS: {
      docsConvertMarkdown: 'docs.convertMarkdown',
      docsOpenDocument: 'docs.openDocument',
    },
  };
});

vi.mock('@octo/base', () => ({
  WKApp: fakeWKApp,
  EndpointID: ENDPOINT_IDS,
}));

import type { OctoBuddySummaryBridge } from './hostBridge';
import { installDocsAdapter } from './docsAdapter';

describe('installDocsAdapter', () => {
  let bridge: OctoBuddySummaryBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeWKApp.shared.currentSpaceId = 'space-42';
    fakeWKApp.loginInfo = { uid: 'user-a', token: 'tok-a' };
    fakeWKApp.endpointManager._methods = {};

    bridge = {
      getBootstrap: vi.fn(),
      reportReady: vi.fn(),
      reportRoute: vi.fn(),
      reportBadge: vi.fn(),
      reportAuthExpired: vi.fn(),
      reportFatalError: vi.fn(),
      openConversation: vi.fn(),
      loadConversationMembers: vi.fn(),
      notifySummaryCompleted: vi.fn(),
      requestForward: vi.fn(),
      onCommand: vi.fn(() => () => {}),
    };
  });

  describe('installation guards', () => {
    it('does nothing when capabilities is undefined', () => {
      bridge.convertMarkdown = vi.fn();
      bridge.openDocument = vi.fn();
      installDocsAdapter(bridge, {});
      const ep = fakeWKApp.endpointManager;
      expect(ep.get(ENDPOINT_IDS.docsConvertMarkdown)).toBeUndefined();
      expect(ep.get(ENDPOINT_IDS.docsOpenDocument)).toBeUndefined();
    });

    it('does nothing when capabilities.docsConversion is false (not true boolean)', () => {
      bridge.convertMarkdown = vi.fn();
      bridge.openDocument = vi.fn();
      installDocsAdapter(bridge, { capabilities: { docsConversion: false } });
      expect(fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)).toBeUndefined();
    });

    it('does nothing when capabilities.docsConversion is 1 (number, not true)', () => {
      bridge.convertMarkdown = vi.fn();
      bridge.openDocument = vi.fn();
      installDocsAdapter(bridge, { capabilities: { docsConversion: 1 as any } });
      expect(fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)).toBeUndefined();
    });

    it('does nothing when convertMarkdown is missing', () => {
      installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });
      expect(fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)).toBeUndefined();
    });

    it('does nothing when openDocument is missing', () => {
      bridge.convertMarkdown = vi.fn();
      installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });
      expect(fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)).toBeUndefined();
    });

    it('does nothing when session.apiOrigin is missing', () => {
      bridge.convertMarkdown = vi.fn();
      bridge.openDocument = vi.fn();
      installDocsAdapter(bridge, { capabilities: { docsConversion: true } });
      expect(fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)).toBeUndefined();
    });

    it('registers both endpoints when all conditions met', () => {
      bridge.convertMarkdown = vi.fn();
      bridge.openDocument = vi.fn();
      installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });
      expect(fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)).toBeDefined();
      expect(fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsOpenDocument)).toBeDefined();
    });
  });

  describe('convertMarkdown endpoint', () => {
    it('proxies to bridge.convertMarkdown and returns value on success', async () => {
      bridge.convertMarkdown = vi.fn(async (_input, _spaceId) => ({
        ok: true as const,
        value: { docId: 'doc-1', url: `${API_ORIGIN}/d/doc-1` },
      }));
      bridge.openDocument = vi.fn();
      installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });

      const handler = fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)!.handler;
      const result = await handler({ title: 't', markdown: 'body' });

      expect(bridge.convertMarkdown).toHaveBeenCalledWith(
        { title: 't', markdown: 'body' },
        'space-42',
      );
      expect(result).toEqual({ docId: 'doc-1', url: `${API_ORIGIN}/d/doc-1` });
    });

    it('throws error with response shape on failed conversion', async () => {
      bridge.convertMarkdown = vi.fn(async () => ({
        ok: false as const,
        error: { message: '太大', status: 413, code: 'doc_too_large' },
      }));
      bridge.openDocument = vi.fn();
      installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });

      const handler = fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)!.handler;
      let thrown: any;
      try { await handler({ title: 't', markdown: 'x' }); } catch (e) { thrown = e; }

      expect(thrown.response.status).toBe(413);
      expect(thrown.response.data.error).toBe('doc_too_large');
    });

    it('preserves an uncertain-create code without inventing an HTTP status', async () => {
      bridge.convertMarkdown = vi.fn(async () => ({
        ok: false as const, error: { message: 'Creation unconfirmed', code: 'create_unconfirmed' },
      }));
      bridge.openDocument = vi.fn();
      installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });
      const handler = fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)!.handler;
      await expect(handler({ title: 't', markdown: 'x' })).rejects.toMatchObject({
        response: { status: undefined, data: { error: 'create_unconfirmed' } },
      });
    });
    it('includes validated error.document on partial failures, rejects malicious url', async () => {
      bridge.convertMarkdown = vi.fn(async () => ({
        ok: false as const,
        error: {
          message: '导入失败，文档已创建',
          document: { docId: 'doc-42', url: `${API_ORIGIN}/d/doc-42` },
        },
      }));
      bridge.openDocument = vi.fn();
      installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });

      const handler = fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)!.handler;
      let thrown: any;
      try { await handler({ title: 't', markdown: 'x' }); } catch (e) { thrown = e; }
      expect(thrown.document).toEqual({ docId: 'doc-42', url: `${API_ORIGIN}/d/doc-42` });
    });

    it('strips malicious error.document url', async () => {
      bridge.convertMarkdown = vi.fn(async () => ({
        ok: false as const,
        error: {
          message: 'partial failure',
          document: { docId: 'doc-42', url: 'https://evil.com/d/doc-42' },
        },
      }));
      bridge.openDocument = vi.fn();
      installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });

      const handler = fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)!.handler;
      let thrown: any;
      try { await handler({ title: 't', markdown: 'x' }); } catch (e) { thrown = e; }
      // Should NOT have document since URL is from different origin
      expect(thrown.document).toBeUndefined();
    });

    it.each([
      `${API_ORIGIN}/d/doc-1?extra=1`,
      `${API_ORIGIN}/d/doc-1#fragment`,
      'https://user@example.com/d/doc-1',
      'https://evil.com/d/doc-1',
      '/d/doc-1',
      '//example.com/d/doc-1',
      'javascript:alert(1)',
    ])('rejects noncanonical or untrusted result URL %s', async (url) => {
      bridge.convertMarkdown = vi.fn(async () => ({
        ok: true as const,
        value: { docId: 'doc-1', url },
      }));
      bridge.openDocument = vi.fn();
      installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });
      const handler = fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)!.handler;
      await expect(handler({ title: 't', markdown: 'x' })).rejects.toThrow('invalid document link from host');
    });

    it('rejects result URL with different path than /d/:docId', async () => {
      fakeWKApp.endpointManager._methods = {};
      bridge.convertMarkdown = vi.fn(async () => ({
        ok: true as const,
        value: { docId: 'doc-1', url: `${API_ORIGIN}/docs?doc=doc-1` },
      }));
      bridge.openDocument = vi.fn();
      installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });
      const handler = fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)!.handler;
      await expect(handler({ title: 't', markdown: 'x' })).rejects.toThrow('invalid document link from host');
    });

    it('rejects stale result after scope change (spaceId)', async () => {
      bridge.convertMarkdown = vi.fn(async () => {
        fakeWKApp.shared.currentSpaceId = 'space-other';
        return { ok: true as const, value: { docId: 'doc-1', url: `${API_ORIGIN}/d/doc-1` } };
      });
      bridge.openDocument = vi.fn();
      installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });

      const handler = fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)!.handler;
      await expect(handler({ title: 't', markdown: 'x' })).rejects.toThrow('summary scope changed during docs conversion');
    });

    it('rejects stale result after uid change', async () => {
      bridge.convertMarkdown = vi.fn(async () => {
        fakeWKApp.loginInfo.uid = 'user-b';
        return { ok: true as const, value: { docId: 'doc-1', url: `${API_ORIGIN}/d/doc-1` } };
      });
      bridge.openDocument = vi.fn();
      installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });

      const handler = fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)!.handler;
      await expect(handler({ title: 't', markdown: 'x' })).rejects.toThrow('summary scope changed during docs conversion');
    });
  });

  describe('openDocument endpoint', () => {
    it('proxies to bridge.openDocument with docId and captured spaceId', async () => {
      bridge.convertMarkdown = vi.fn();
      bridge.openDocument = vi.fn(async () => {});
      installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });

      const handler = fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsOpenDocument)!.handler;
      await handler({ docId: 'doc-1', url: `${API_ORIGIN}/d/doc-1` }, 'space-42');

      expect(bridge.openDocument).toHaveBeenCalledWith({ docId: 'doc-1' }, 'space-42');
    });

    it('does not navigate when identity changed after install', async () => {
      bridge.convertMarkdown = vi.fn();
      bridge.openDocument = vi.fn(async () => {});
      installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });

      const handler = fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsOpenDocument)!.handler;
      // Identity changes after install:
      fakeWKApp.loginInfo.uid = 'user-b';
      await expect(handler({ docId: 'doc-old', url: `${API_ORIGIN}/d/doc-old` }, 'space-42')).rejects.toThrow('scope expired');

      expect(bridge.openDocument).not.toHaveBeenCalled();
    });

    it('does not navigate when token changes after install', async () => {
      bridge.convertMarkdown = vi.fn();
      bridge.openDocument = vi.fn(async () => {});
      installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });

      const handler = fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsOpenDocument)!.handler;
      fakeWKApp.loginInfo.token = 'tok-b';
      await expect(handler({ docId: 'doc-1', url: `${API_ORIGIN}/d/doc-1` }, 'space-42')).rejects.toThrow('scope expired');

      expect(bridge.openDocument).not.toHaveBeenCalled();
    });

    it('does not navigate when spaceId mismatch', async () => {
      bridge.convertMarkdown = vi.fn();
      bridge.openDocument = vi.fn(async () => {});
      installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });

      const handler = fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsOpenDocument)!.handler;
      await expect(handler({ docId: 'doc-old', url: `${API_ORIGIN}/d/doc-old` }, 'space-old')).rejects.toThrow('scope expired');

      expect(bridge.openDocument).not.toHaveBeenCalled();
    });

    it('allows a new opener in the current Space without accepting a stale Space', async () => {
      bridge.convertMarkdown = vi.fn();
      bridge.openDocument = vi.fn(async () => {});
      installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });
      fakeWKApp.shared.currentSpaceId = 'space-new';
      const handler = fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsOpenDocument)!.handler;
      await expect(handler({ docId: 'doc-1', url: `${API_ORIGIN}/d/doc-1` }, 'space-42')).rejects.toThrow('scope expired');
      await handler({ docId: 'doc-1', url: `${API_ORIGIN}/d/doc-1` }, 'space-new');
      expect(bridge.openDocument).toHaveBeenCalledExactlyOnceWith({ docId: 'doc-1' }, 'space-new');
    });
  });
});
