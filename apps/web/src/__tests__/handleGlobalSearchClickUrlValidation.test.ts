import { vi, describe, it, expect, beforeEach } from 'vitest'

import { isSafeUrl } from '../../../../packages/dmworkbase/src/Utils/security';

import { handleGlobalSearchClick } from '../../../../packages/dmworkbase/src/Pages/Chat/vm';
import { downloadFile } from '../../../../packages/dmworkbase/src/Utils/download';

// Mock downloadFile
vi.mock('../../../../packages/dmworkbase/src/Utils/download', () => ({
    downloadFile: vi.fn(),
}));

// Mock WKApp
vi.mock('../../../../packages/dmworkbase/src/App', () => ({
    default: {
        dataSource: {
            commonDataSource: {
                getFileURL: vi.fn((url: string) => url)
            }
        },
        endpoints: {
            showConversation: vi.fn()
        }
    }
}));

// Mock vm.ts transitive dependencies
vi.mock('wukongimjssdk', () => ({
    default: {},
    MessageContentType: {},
    Channel: vi.fn(),
    ChannelTypePerson: 1,
    ChannelTypeGroup: 2,
    ChannelInfo: vi.fn(),
    Conversation: vi.fn(),
    Message: vi.fn(),
    ConnectStatus: {},
    ConversationAction: {},
    WKSDK: { shared: vi.fn(() => ({ connectManager: {}, conversationManager: {}, channelManager: {} })) },
}));
vi.mock('react-scroll', () => ({
    animateScroll: { scrollToBottom: vi.fn() },
    scroller: { scrollTo: vi.fn() },
}));
vi.mock('../../../../packages/dmworkbase/src/Service/Model', () => ({
    ConversationWrap: vi.fn(),
}));
vi.mock('../../../../packages/dmworkbase/src/Service/Provider', () => ({
    ProviderListener: class {},
    default: class {},
}));
vi.mock('../../../../packages/dmworkbase/src/Service/ProhibitwordsService', () => ({
    ProhibitwordsService: { shared: { filter: vi.fn((t: string) => t) } },
}));
vi.mock('../../../../packages/dmworkbase/src/Service/SpaceService', () => ({
    shouldSkipChannelForSpace: vi.fn(),
    shouldSkipPersonConversationForSpace: vi.fn(),
    hasSpacePrefix: vi.fn(),
    SpaceService: { shared: { getMembers: vi.fn() } },
    Space: vi.fn(),
}));
vi.mock('../../../../packages/dmworkbase/src/Service/Const', () => ({
    EndpointID: {},
    MessageContentTypeConst: {},
}));
vi.mock('../../../../packages/dmworkbase/src/EndpointCommon', () => ({
    ShowConversationOptions: class {},
}));

describe('handleGlobalSearchClick file download URL validation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ---- Existing isSafeUrl isolation tests (UNCHANGED) ----

    describe('URL validation integration', () => {
        it('should validate URL with isSafeUrl before opening', () => {
            expect(isSafeUrl('https://example.com/file.pdf')).toBe(true);
            expect(isSafeUrl('http://example.com/file.pdf')).toBe(true);
        });

        it('should reject javascript: protocol URLs', () => {
            expect(isSafeUrl('javascript:alert(1)')).toBe(false);
            expect(isSafeUrl('javascript:void(0)')).toBe(false);
        });

        it('should reject data: protocol URLs', () => {
            expect(isSafeUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
        });

        it('should reject file: protocol URLs', () => {
            expect(isSafeUrl('file:///etc/passwd')).toBe(false);
        });
    });

    describe('security validation for file downloads', () => {
        it('should block malicious URLs from being opened', () => {
            const maliciousUrls = [
                'javascript:alert(document.cookie)',
                'data:text/html,<script>alert(1)</script>',
                'vbscript:msgbox(1)',
                'file:///etc/passwd'
            ];

            maliciousUrls.forEach(url => {
                expect(isSafeUrl(url)).toBe(false);
            });
        });

        it('should allow legitimate file download URLs', () => {
            const safeUrls = [
                'https://cdn.example.com/files/document.pdf',
                'http://localhost:8080/api/download/file.zip',
                'https://storage.example.com/uploads/image.png?filename=test.png'
            ];

            safeUrls.forEach(url => {
                expect(isSafeUrl(url)).toBe(true);
            });
        });
    });

    // ---- New integration tests ----

    describe('file download via downloadFile', () => {
        it('should call downloadFile with getFileURL result and payload name', async () => {
            const item = {
                payload: {
                    url: 'https://cdn.example.com/files/document.pdf',
                    name: 'my-document.pdf',
                    size: 1024,
                },
            };
            await handleGlobalSearchClick(item, 'file');
            expect(downloadFile).toHaveBeenCalledWith(
                'https://cdn.example.com/files/document.pdf',
                'my-document.pdf',
            );
        });

        it('should not call downloadFile for unsafe URLs', async () => {
            const WKApp = (await import('../../../../packages/dmworkbase/src/App')).default;
            vi.mocked(WKApp.dataSource.commonDataSource.getFileURL).mockReturnValueOnce(
                'javascript:alert(1)'
            );
            const item = {
                payload: { url: 'anything', name: 'evil.pdf', size: 0 },
            };
            await handleGlobalSearchClick(item, 'file');
            expect(downloadFile).not.toHaveBeenCalled();
        });
    });
});
