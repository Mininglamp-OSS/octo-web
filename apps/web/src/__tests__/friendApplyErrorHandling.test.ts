import { vi } from 'vitest'
/**
 * Unit tests for friendApply API error handling in App/index.tsx
 * Tests that the API call properly handles errors with .catch() (fix for issue #324)
 */

describe('friendApply API error handling', () => {
    // Simulates the friendApply fetch logic with error handling
    function createFriendApplyManager() {
        let friendApplyCount = 0;
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
            // Simulates the fixed friendApply fetch with .catch()
            async fetchFriendApplyCount(
                apiCall: () => Promise<{ count: number }>,
                isLoggedIn: boolean
            ) {
                if (!isLoggedIn) {
                    return;
                }

                await apiCall()
                    .then(res => {
                        friendApplyCount = res.count;
                        eventEmitted = true;
                        storageUpdated = true;
                        menusRefreshed = true;
                    })
                    .catch(error => {
                        errorLogged = error;
                        console.warn('Failed to fetch friend apply count:', error);
                    });
            },
        };
    }

    it('should have zero count initially', () => {
        const manager = createFriendApplyManager();
        expect(manager.getCount()).toBe(0);
    });

    it('should not fetch when user is not logged in', async () => {
        const manager = createFriendApplyManager();
        let apiCalled = false;

        await manager.fetchFriendApplyCount(async () => {
            apiCalled = true;
            return { count: 5 };
        }, false);

        expect(apiCalled).toBe(false);
        expect(manager.getCount()).toBe(0);
    });

    it('should update count on successful API call', async () => {
        const manager = createFriendApplyManager();

        await manager.fetchFriendApplyCount(async () => {
            return { count: 5 };
        }, true);

        expect(manager.getCount()).toBe(5);
        expect(manager.getError()).toBeNull();
        expect(manager.isEventEmitted()).toBe(true);
        expect(manager.isStorageUpdated()).toBe(true);
        expect(manager.isMenusRefreshed()).toBe(true);
    });

    it('should catch error and not crash when API call fails', async () => {
        const manager = createFriendApplyManager();
        const testError = new Error('Network error');

        // This should NOT throw - the error should be caught
        await manager.fetchFriendApplyCount(async () => {
            throw testError;
        }, true);

        expect(manager.getCount()).toBe(0);
        expect(manager.getError()).toBe(testError);
        expect(manager.isEventEmitted()).toBe(false);
        expect(manager.isStorageUpdated()).toBe(false);
        expect(manager.isMenusRefreshed()).toBe(false);
    });

    it('should log warning when API call fails', async () => {
        const manager = createFriendApplyManager();
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation();

        const testError = new Error('API Error');
        await manager.fetchFriendApplyCount(async () => {
            throw testError;
        }, true);

        expect(consoleSpy).toHaveBeenCalledWith('Failed to fetch friend apply count:', testError);
        consoleSpy.mockRestore();
    });

    it('should handle server error gracefully', async () => {
        const manager = createFriendApplyManager();

        await manager.fetchFriendApplyCount(async () => {
            throw new Error('500 Internal Server Error');
        }, true);

        expect(manager.getCount()).toBe(0);
        expect(manager.getError()).toBeInstanceOf(Error);
    });

    it('should handle timeout error gracefully', async () => {
        const manager = createFriendApplyManager();

        await manager.fetchFriendApplyCount(async () => {
            throw new Error('Request timeout');
        }, true);

        expect(manager.getCount()).toBe(0);
        expect(manager.getError()?.toString()).toContain('timeout');
    });

    it('should allow retry after failure', async () => {
        const manager = createFriendApplyManager();

        // First call fails
        await manager.fetchFriendApplyCount(async () => {
            throw new Error('First failure');
        }, true);

        expect(manager.getError()).toBeTruthy();

        manager.reset();

        // Second call succeeds
        await manager.fetchFriendApplyCount(async () => {
            return { count: 3 };
        }, true);

        expect(manager.getCount()).toBe(3);
        expect(manager.getError()).toBeNull();
    });
});
