// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EndpointManager } from '../../Service/Module';
import { EndpointID } from '../../Service/Const';

const { fakeApp } = vi.hoisted(() => ({
  fakeApp: {
    remoteConfig: { docsOn: false },
    endpointManager: null as unknown as typeof EndpointManager.shared,
  },
}));
vi.mock('../../App', () => ({ default: fakeApp }));
fakeApp.endpointManager = EndpointManager.shared;

import {
  getDocsDocumentOpener,
  DocsCapabilityUnavailableError,
  convertMarkdownToDoc,
  isDocsConvertAvailable,
  ConvertMarkdownToDocResult,
} from './docsPort';

describe('getDocsDocumentOpener', () => {
  beforeEach(() => {
    EndpointManager.shared.removeMethod(EndpointID.docsOpenDocument);
    fakeApp.remoteConfig.docsOn = false;
    (fakeApp as any).loginInfo = { uid: 'user-a', token: 'tok-a' };
    (fakeApp as any).shared = { currentSpaceId: 'space-42' };
  });

  it('returns undefined when no opener registered (normal Web)', () => {
    expect(getDocsDocumentOpener()).toBeUndefined();
  });

  it('returns a function when opener endpoint is registered', () => {
    const handler = vi.fn(async () => {});
    EndpointManager.shared.setMethod(EndpointID.docsOpenDocument, handler);
    const opener = getDocsDocumentOpener();
    expect(opener).toBeInstanceOf(Function);
  });

  it('invoked opener passes docId, url and captured spaceId', async () => {
    const handler = vi.fn(async () => {});
    EndpointManager.shared.setMethod(EndpointID.docsOpenDocument, handler);
    const opener = getDocsDocumentOpener()!;
    const result: ConvertMarkdownToDocResult = { docId: 'doc-1', url: '/d/doc-1' };
    await opener(result);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      { docId: 'doc-1', url: '/d/doc-1' },
      'space-42',
    );
  });

  it('rejects stale opener call when spaceId changes', async () => {
    const handler = vi.fn(async () => {});
    EndpointManager.shared.setMethod(EndpointID.docsOpenDocument, handler);
    const opener = getDocsDocumentOpener()!;
    (fakeApp as any).shared.currentSpaceId = 'space-other';
    const result: ConvertMarkdownToDocResult = { docId: 'doc-1', url: '/d/doc-1' };
    await expect(opener(result)).rejects.toThrow('document opener scope expired');
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects stale opener call with docId/url when uid changes', async () => {
    const handler = vi.fn(async () => {});
    EndpointManager.shared.setMethod(EndpointID.docsOpenDocument, handler);
    const opener = getDocsDocumentOpener()!;
    (fakeApp as any).loginInfo.uid = 'user-b';
    const result: ConvertMarkdownToDocResult = { docId: 'doc-1', url: '/d/doc-1' };
    let thrown: any;
    try { await opener(result); } catch (e) { thrown = e; }

    expect(thrown).toBeDefined();
    expect(thrown.document).toEqual({ docId: 'doc-1', url: '/d/doc-1' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects stale opener call when token changes', async () => {
    const handler = vi.fn(async () => {});
    EndpointManager.shared.setMethod(EndpointID.docsOpenDocument, handler);
    const opener = getDocsDocumentOpener()!;
    (fakeApp as any).loginInfo.token = 'tok-b';
    const result: ConvertMarkdownToDocResult = { docId: 'doc-1', url: '/d/doc-1' };
    await expect(opener(result)).rejects.toThrow('document opener scope expired');
    expect(handler).not.toHaveBeenCalled();
  });

  it('opener registration does not affect isDocsConvertAvailable', () => {
    EndpointManager.shared.setMethod(EndpointID.docsOpenDocument, vi.fn(async () => {}));
    expect(isDocsConvertAvailable()).toBe(false);

    fakeApp.remoteConfig.docsOn = true;
    expect(isDocsConvertAvailable()).toBe(false);
  });

  it('opener works independently of docsOn and docsConvertMarkdown', () => {
    EndpointManager.shared.setMethod(EndpointID.docsOpenDocument, vi.fn(async () => {}));
    const opener = getDocsDocumentOpener();
    expect(opener).toBeInstanceOf(Function);
  });
});
