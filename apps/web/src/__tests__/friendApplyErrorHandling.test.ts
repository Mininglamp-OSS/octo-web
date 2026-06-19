import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    clearDeprecatedFriendApplyReddotOnce,
    resetDeprecatedFriendApplyReddotCleanupForTest,
} from '../App/friendApplyReddotCleanup'

/**
 * Unit tests for friendApply reddot cleanup in App/index.tsx.
 * The cleanup is guarded so React re-renders / StrictMode duplicate effects
 * cannot repeatedly issue DELETE /user/reddot/friendApply for the same user.
 */

describe('friendApply reddot cleanup', () => {
    function createCleanupDeps(initialCount = 0, uid = 'user-1') {
        let friendApplyCount = initialCount;
        let errorLogged: unknown = null;
        let apiCalled = 0;
        let menusRefreshed = false;
        let storageUpdated = false;
        let eventEmitted = false;
        let isLoggedIn = true;
        let currentUid = uid;
        let shouldReject = false;
        let clearReddotImpl: (() => Promise<void>) | undefined;

        return {
            deps: {
                isLoggedIn: () => isLoggedIn,
                getUid: () => currentUid,
                clearReddot: async () => {
                    apiCalled++;
                    if (shouldReject) {
                        throw new Error('API Error');
                    }
                    await clearReddotImpl?.();
                },
                emitUnreadCount: (count: number) => {
                    friendApplyCount = count;
                    eventEmitted = true;
                },
                setUnreadCount: (_uid: string, count: string) => {
                    friendApplyCount = Number(count);
                    storageUpdated = true;
                },
                refreshMenus: () => {
                    menusRefreshed = true;
                },
                warn: (_message: string, error: unknown) => {
                    errorLogged = error;
                    console.warn('Failed to clear friend apply count:', error);
                },
            },
            getCount: () => friendApplyCount,
            getError: () => errorLogged,
            getApiCalled: () => apiCalled,
            isMenusRefreshed: () => menusRefreshed,
            isStorageUpdated: () => storageUpdated,
            isEventEmitted: () => eventEmitted,
            setLoggedIn: (value: boolean) => {
                isLoggedIn = value;
            },
            setUid: (value: string) => {
                currentUid = value;
            },
            rejectNextCalls: () => {
                shouldReject = true;
            },
            setClearReddotImpl: (impl: () => Promise<void>) => {
                clearReddotImpl = impl;
            },
        };
    }

    beforeEach(() => {
        resetDeprecatedFriendApplyReddotCleanupForTest();
    });

    it('should not clear when user is not logged in', async () => {
        const manager = createCleanupDeps(5);
        manager.setLoggedIn(false);

        const started = await clearDeprecatedFriendApplyReddotOnce(manager.deps);

        expect(started).toBe(false);
        expect(manager.getApiCalled()).toBe(0);
        expect(manager.getCount()).toBe(5);
    });

    it('should not clear when logged-in user has no uid', async () => {
        const manager = createCleanupDeps(5);
        manager.setUid('');

        const started = await clearDeprecatedFriendApplyReddotOnce(manager.deps);

        expect(started).toBe(false);
        expect(manager.getApiCalled()).toBe(0);
        expect(manager.getCount()).toBe(5);
    });

    it('should clear count on successful API call', async () => {
        const manager = createCleanupDeps(5);

        const started = await clearDeprecatedFriendApplyReddotOnce(manager.deps);

        expect(started).toBe(true);
        expect(manager.getApiCalled()).toBe(1);
        expect(manager.getCount()).toBe(0);
        expect(manager.getError()).toBeNull();
        expect(manager.isEventEmitted()).toBe(true);
        expect(manager.isStorageUpdated()).toBe(true);
        expect(manager.isMenusRefreshed()).toBe(true);
    });

    it('should only clear once for the same logged-in user', async () => {
        const manager = createCleanupDeps(5);

        const firstStarted = await clearDeprecatedFriendApplyReddotOnce(manager.deps);
        const secondStarted = await clearDeprecatedFriendApplyReddotOnce(manager.deps);

        expect(firstStarted).toBe(true);
        expect(secondStarted).toBe(false);
        expect(manager.getApiCalled()).toBe(1);
    });

    it('should only clear once for concurrent same-user calls', async () => {
        const manager = createCleanupDeps(5);
        let releaseClear!: () => void;
        const clearStarted = new Promise<void>((resolve) => {
            releaseClear = resolve;
        });
        manager.setClearReddotImpl(() => clearStarted);

        const firstCall = clearDeprecatedFriendApplyReddotOnce(manager.deps);
        const secondCall = clearDeprecatedFriendApplyReddotOnce(manager.deps);

        releaseClear();
        const results = await Promise.all([firstCall, secondCall]);

        expect(results).toContain(true);
        expect(results).toContain(false);
        expect(manager.getApiCalled()).toBe(1);
    });

    it('should clear once for each logged-in user', async () => {
        const manager = createCleanupDeps(5, 'user-1');

        await clearDeprecatedFriendApplyReddotOnce(manager.deps);
        manager.setUid('user-2');
        const secondUserStarted = await clearDeprecatedFriendApplyReddotOnce(manager.deps);

        expect(secondUserStarted).toBe(true);
        expect(manager.getApiCalled()).toBe(2);
    });

    it('should catch error and not crash when API call fails', async () => {
        const manager = createCleanupDeps(5);
        manager.rejectNextCalls();

        const started = await clearDeprecatedFriendApplyReddotOnce(manager.deps);

        expect(started).toBe(true);
        expect(manager.getApiCalled()).toBe(1);
        expect(manager.getCount()).toBe(5);
        expect(manager.getError()).toBeInstanceOf(Error);
        expect(manager.isEventEmitted()).toBe(false);
        expect(manager.isStorageUpdated()).toBe(false);
        expect(manager.isMenusRefreshed()).toBe(false);
    });

    it('should log warning when API call fails', async () => {
        const manager = createCleanupDeps();
        manager.rejectNextCalls();
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation();

        await clearDeprecatedFriendApplyReddotOnce(manager.deps);

        expect(consoleSpy).toHaveBeenCalledWith('Failed to clear friend apply count:', expect.any(Error));
        consoleSpy.mockRestore();
    });

    it('should not retry the same user after failure', async () => {
        const manager = createCleanupDeps(5);
        manager.rejectNextCalls();

        const firstStarted = await clearDeprecatedFriendApplyReddotOnce(manager.deps);
        const secondStarted = await clearDeprecatedFriendApplyReddotOnce(manager.deps);

        expect(firstStarted).toBe(true);
        expect(secondStarted).toBe(false);
        expect(manager.getApiCalled()).toBe(1);
    });
});
