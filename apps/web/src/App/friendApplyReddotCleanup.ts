export type FriendApplyReddotCleanupDeps = {
  isLoggedIn: () => boolean;
  getUid: () => string;
  clearReddot: () => Promise<void>;
  emitUnreadCount: (count: number) => void;
  setUnreadCount: (uid: string, count: string) => void;
  refreshMenus: () => void;
  warn: (message: string, error: unknown) => void;
};

const cleanedUids = new Set<string>();

/**
 * Clears the deprecated friendApply reddot once for each logged-in uid.
 *
 * The friendApply badge UI is removed, but old server/storage reddot state can
 * still exist for returning users. The module-level Set keeps this migration
 * idempotent across React re-renders, StrictMode duplicate effects, and
 * concurrent calls.
 *
 * @returns true when this call attempted cleanup for the uid; false when it was
 * skipped because the user is logged out, uid is empty, or cleanup was already
 * attempted for this uid. DELETE failures are warned and swallowed, so true does
 * not mean the server cleanup succeeded.
 */
export async function clearDeprecatedFriendApplyReddotOnce(
  deps: FriendApplyReddotCleanupDeps
): Promise<boolean> {
  const uid = deps.getUid();
  if (!deps.isLoggedIn() || !uid || cleanedUids.has(uid)) {
    return false;
  }

  cleanedUids.add(uid);

  try {
    await deps.clearReddot();
    deps.emitUnreadCount(0);
    deps.setUnreadCount(uid, "0");
    deps.refreshMenus();
  } catch (error) {
    deps.warn('Failed to clear friend apply count:', error);
  }

  return true;
}

export function resetDeprecatedFriendApplyReddotCleanupForTest() {
  cleanedUids.clear();
}
