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

        return {
            deps: {
                isLoggedIn: () => isLoggedIn,
                getUid: () => currentUid,
                clearReddot: async () => {
                    apiCalled++;
                    if (shouldReject) {
                        throw new Error('API Error');
                    }
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
        };
    }

    beforeEach(() => {
        resetDeprecatedFriendApplyReddotCleanupForTest();
    });

    it('should have zero count initially', () => {
        const manager = createCleanupDeps();
        expect(manager.getCount()).toBe(0);
    });

    it('should not clear when user is not logged in', async () => {
        const manager = createCleanupDeps(5);
        manager.setLoggedIn(false);

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
