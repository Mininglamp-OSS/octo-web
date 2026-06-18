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
