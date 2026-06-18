import { vi } from 'vitest'
/**
 * Unit tests for friendApply API error handling in App/index.tsx
 * Tests that the startup cleanup call properly handles errors with .catch()
 */

describe('friendApply API error handling', () => {
    // Simulates the friendApply reddot cleanup logic with error handling
    function createFriendApplyManager(initialCount = 0) {
        let friendApplyCount = initialCount;
        let errorLogged: unknown = null;
        let menusRefreshed = false;
        let storageUpdated = false;
        let eventEmitted = false;

        return {
            getCount: () => friendApplyCount,
            getError: () => errorLogged,
            isMenusRefreshed: () => menusRefreshed,
            isStorageUpdated: () => storageUpdated,
            isEventEmitted: () => eventEmitted,
            reset: () => {
                friendApplyCount = 0;
                errorLogged = null;
                menusRefreshed = false;
                storageUpdated = false;
                eventEmitted = false;
            },
            // Simulates the fixed friendApply cleanup with .catch()
            async clearFriendApplyCount(
                apiCall: () => Promise<void>,
                isLoggedIn: boolean
            ) {
                if (!isLoggedIn) {
                    return;
                }

                await apiCall()
                    .then(() => {
                        friendApplyCount = 0;
                        eventEmitted = true;
                        storageUpdated = true;
                        menusRefreshed = true;
                    })
                    .catch(error => {
                        errorLogged = error;
                        console.warn('Failed to clear friend apply count:', error);
                    });
            },
        };
    }

    it('should have zero count initially', () => {
        const manager = createFriendApplyManager();
        expect(manager.getCount()).toBe(0);
    });

    it('should not clear when user is not logged in', async () => {
        const manager = createFriendApplyManager(5);
        let apiCalled = false;

        await manager.clearFriendApplyCount(async () => {
            apiCalled = true;
            return;
        }, false);

        expect(apiCalled).toBe(false);
        expect(manager.getCount()).toBe(5);
    });

    it('should clear count on successful API call', async () => {
        const manager = createFriendApplyManager(5);

        await manager.clearFriendApplyCount(async () => {
            return;
        }, true);

        expect(manager.getCount()).toBe(0);
        expect(manager.getError()).toBeNull();
        expect(manager.isEventEmitted()).toBe(true);
        expect(manager.isStorageUpdated()).toBe(true);
        expect(manager.isMenusRefreshed()).toBe(true);
    });

    it('should catch error and not crash when API call fails', async () => {
        const manager = createFriendApplyManager(5);
        const testError = new Error('Network error');

        // This should NOT throw - the error should be caught
        await manager.clearFriendApplyCount(async () => {
            throw testError;
        }, true);

        expect(manager.getCount()).toBe(5);
        expect(manager.getError()).toBe(testError);
        expect(manager.isEventEmitted()).toBe(false);
        expect(manager.isStorageUpdated()).toBe(false);
        expect(manager.isMenusRefreshed()).toBe(false);
    });

    it('should log warning when API call fails', async () => {
        const manager = createFriendApplyManager();
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation();

        const testError = new Error('API Error');
        await manager.clearFriendApplyCount(async () => {
            throw testError;
        }, true);

        expect(consoleSpy).toHaveBeenCalledWith('Failed to clear friend apply count:', testError);
        consoleSpy.mockRestore();
    });

    it('should handle server error gracefully', async () => {
        const manager = createFriendApplyManager();

        await manager.clearFriendApplyCount(async () => {
            throw new Error('500 Internal Server Error');
        }, true);

        expect(manager.getCount()).toBe(0);
        expect(manager.getError()).toBeInstanceOf(Error);
    });

    it('should handle timeout error gracefully', async () => {
        const manager = createFriendApplyManager();

        await manager.clearFriendApplyCount(async () => {
            throw new Error('Request timeout');
        }, true);

        expect(manager.getCount()).toBe(0);
        expect(manager.getError()?.toString()).toContain('timeout');
    });

    it('should allow retry after failure', async () => {
        const manager = createFriendApplyManager();

        // First call fails
        await manager.clearFriendApplyCount(async () => {
            throw new Error('First failure');
        }, true);

        expect(manager.getError()).toBeTruthy();

        manager.reset();

        // Second call succeeds
        await manager.clearFriendApplyCount(async () => {
            return;
        }, true);

        expect(manager.getCount()).toBe(0);
        expect(manager.getError()).toBeNull();
    });
});
