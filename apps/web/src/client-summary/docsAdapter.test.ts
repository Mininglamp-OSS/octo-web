// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OctoBuddySummaryBridge } from './hostBridge';
import { installDocsAdapter } from './docsAdapter';

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

vi.mock('@octo/base', async () => ({
  WKApp: fakeWKApp,
  EndpointID: ENDPOINT_IDS,
  ...await import('../../../../packages/dmworkbase/src/bridge/docs/documentLink'),
}));

describe('installDocsAdapter', () => {
  let bridge: OctoBuddySummaryBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
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
  afterEach(() => vi.restoreAllMocks());

  describe('installation guards', () => {
    it('does nothing when capabilities is undefined', () => {
      bridge.convertMarkdown = vi.fn();
      bridge.openDocument = vi.fn();
      installDocsAdapter(bridge, {});
      const ep = fakeWKApp.endpointManager;
      expect(ep.get(ENDPOINT_IDS.docsConvertMarkdown)).toBeUndefined();
      expect(ep.get(ENDPOINT_IDS.docsOpenDocument)).toBeUndefined();
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('does nothing when capabilities.docsConversion is false (not true boolean)', () => {
      bridge.convertMarkdown = vi.fn();
      bridge.openDocument = vi.fn();
      installDocsAdapter(bridge, { capabilities: { docsConversion: false } });
      expect(fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)).toBeUndefined();
    });

    it.each([1, "true", null])('diagnoses malformed capability %s without installing', (value) => {
      bridge.convertMarkdown = vi.fn();
      bridge.openDocument = vi.fn();
      installDocsAdapter(bridge, { capabilities: { docsConversion: value as any } });
      expect(fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)).toBeUndefined();
      expect(console.warn).toHaveBeenCalledExactlyOnceWith('[client-summary] docs adapter not installed: invalid capability flag');
    });

    it('does nothing when convertMarkdown is missing', () => {
      installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });
      expect(fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)).toBeUndefined();
      expect(console.warn).toHaveBeenCalledExactlyOnceWith('[client-summary] docs adapter not installed: missing bridge methods');
    });

    it('does nothing when openDocument is missing', () => {
      bridge.convertMarkdown = vi.fn();
      installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });
      expect(fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)).toBeUndefined();
      expect(console.warn).toHaveBeenCalledExactlyOnceWith('[client-summary] docs adapter not installed: missing bridge methods');
    });

    it('does nothing when session.apiOrigin is missing', () => {
      bridge.convertMarkdown = vi.fn();
      bridge.openDocument = vi.fn();
      installDocsAdapter(bridge, { capabilities: { docsConversion: true } });
      expect(fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)).toBeUndefined();
      expect(console.warn).toHaveBeenCalledExactlyOnceWith('[client-summary] docs adapter not installed: invalid API origin');
    });

    it('registers both endpoints when all conditions met', () => {
      bridge.convertMarkdown = vi.fn();
      bridge.openDocument = vi.fn();
      installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });
      expect(fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)).toBeDefined();
      expect(fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsOpenDocument)).toBeDefined();
    });
    it.each([`${API_ORIGIN}/`, 'https://EXAMPLE.com:443/api/v1'])('normalizes configured origin %s', async (apiOrigin) => {
      bridge.convertMarkdown = vi.fn().mockResolvedValue({ ok: true, value: { docId: 'doc-1', url: `${API_ORIGIN}/d/doc-1` } });
      bridge.openDocument = vi.fn();
      installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin } });
      const handler = fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)!.handler;
      await expect(handler({ title: 't', markdown: 'x' })).resolves.toEqual({ docId: 'doc-1', url: `${API_ORIGIN}/d/doc-1` });
      expect(console.warn).not.toHaveBeenCalled();
    });
    it.each(['file:///docs', 'not-a-url', 'https://user:secret@example.com', `${API_ORIGIN}?token=secret`])(
      'rejects malformed origin without logging its contents: %s',
      (apiOrigin) => {
        bridge.convertMarkdown = vi.fn();
        bridge.openDocument = vi.fn();
        installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin } });
        expect(fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)).toBeUndefined();
        expect(console.warn).toHaveBeenCalledExactlyOnceWith('[client-summary] docs adapter not installed: invalid API origin');
      },
    );
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
    it('includes validated error.document on partial failures', async () => {
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

    it.each([
      'https://evil.com/d/doc-1',
      'javascript:alert(1)',
      'data:text/html,unsafe',
      `${API_ORIGIN}/d/doc-1?token=secret`,
      'https://user@example.com/d/doc-1',
      '/d/doc-1',
    ])('sanitizes rejected bridge errors carrying %s', async (url) => {
      const rejection = Object.assign(new Error('import failed'), {
        document: { docId: 'doc-1', url },
        response: { status: 422, data: { error: 'import_failed' } },
      });
      bridge.convertMarkdown = vi.fn().mockRejectedValue(rejection);
      bridge.openDocument = vi.fn();
      installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });
      const thrown = await fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)!.handler({ title: 't', markdown: 'x' })
        .catch((error: unknown) => error);
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown).not.toBe(rejection);
      expect(thrown.document).toBeUndefined();
      expect(thrown.response).toEqual({ status: 422, data: { error: 'import_failed' } });
    });

    it('preserves a validated document and status in a rejected bridge error', async () => {
      const document = { docId: 'doc-1', url: `${API_ORIGIN}/d/doc-1` };
      bridge.convertMarkdown = vi.fn().mockRejectedValue({ message: 'import failed', status: 422, code: 'import_failed', document });
      bridge.openDocument = vi.fn();
      installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });
      await expect(fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)!.handler({ title: 't', markdown: 'x' }))
        .rejects.toMatchObject({ document, response: { status: 422, data: { error: 'import_failed' } } });
    });

    it.each(['space', 'uid', 'token'])('discards rejected documents after a %s change', async (change) => {
      bridge.convertMarkdown = vi.fn(async () => {
        if (change === 'space') fakeWKApp.shared.currentSpaceId = 'other-space';
        if (change === 'uid') fakeWKApp.loginInfo.uid = 'other-user';
        if (change === 'token') fakeWKApp.loginInfo.token = 'other-token';
        throw Object.assign(new Error('import failed'), {
          document: { docId: 'doc-1', url: `${API_ORIGIN}/d/doc-1` },
        });
      });
      bridge.openDocument = vi.fn();
      installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });
      const thrown = await fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)!.handler({ title: 't', markdown: 'x' })
        .catch((error: unknown) => error);
      expect(thrown.message).toBe('summary scope changed during docs conversion');
      expect(thrown.document).toBeUndefined();
      expect(thrown.response.data.error).toBe('create_unconfirmed');
    });

    it.each([null, undefined, 'failure', { document: null }])('normalizes malformed rejection %s', async (error) => {
      bridge.convertMarkdown = vi.fn().mockRejectedValue(error);
      bridge.openDocument = vi.fn();
      installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });
      await expect(fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)!.handler({ title: 't', markdown: 'x' }))
        .rejects.toThrow('document conversion failed');
    });

    it.each([null, undefined, {}, { ok: 'true', value: { docId: 'doc-1', url: `${API_ORIGIN}/d/doc-1` } }])(
      'rejects malformed result envelopes %s',
      async (response) => {
        bridge.convertMarkdown = vi.fn().mockResolvedValue(response);
        bridge.openDocument = vi.fn();
        installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });
        await expect(fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)!.handler({ title: 't', markdown: 'x' }))
          .rejects.toThrow('invalid document link from host');
      },
    );

    it.each([undefined, null, [], { title: 1, markdown: 'x' }])('rejects invalid input %s without IPC', async (input) => {
      bridge.convertMarkdown = vi.fn();
      bridge.openDocument = vi.fn();
      installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });
      await expect(fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsConvertMarkdown)!.handler(input))
        .rejects.toThrow('invalid document conversion input');
      expect(bridge.convertMarkdown).not.toHaveBeenCalled();
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
      const thrown = await handler({ title: 't', markdown: 'x' }).catch((error: unknown) => error);
      expect(thrown.message).toBe('invalid document link from host');
      expect(thrown.response.data.error).toBe('create_unconfirmed');
      expect(thrown.document).toBeUndefined();
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
      const thrown = await handler({ title: 't', markdown: 'x' }).catch((error: unknown) => error);
      expect(thrown.message).toBe('summary scope changed during docs conversion');
      expect(thrown.response.data.error).toBe('create_unconfirmed');
      expect(thrown.document).toBeUndefined();
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
    it.each([undefined, null, [], {}, { docId: 'doc-1', url: 'javascript:alert(1)' }])(
      'rejects malformed opening parameters %s without a TypeError or IPC',
      async (input) => {
        bridge.convertMarkdown = vi.fn();
        bridge.openDocument = vi.fn();
        installDocsAdapter(bridge, { capabilities: { docsConversion: true }, session: { apiOrigin: API_ORIGIN } });
        await expect(fakeWKApp.endpointManager.get(ENDPOINT_IDS.docsOpenDocument)!.handler(input, 'space-42'))
          .rejects.toThrow('invalid document link from host');
        expect(bridge.openDocument).not.toHaveBeenCalled();
      },
    );
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
