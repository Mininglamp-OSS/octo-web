const CURRENT_SPACE_STORAGE_KEY = "currentSpaceId";
const LAST_SPACE_STORAGE_PREFIX = "octo:last-space:";

export function getLastSpaceStorageKey(uid: string): string | undefined {
  const normalizedUid = uid.trim();
  if (!normalizedUid) return undefined;
  return `${LAST_SPACE_STORAGE_PREFIX}${encodeURIComponent(normalizedUid)}`;
}

export function readLastSpaceId(
  uid: string,
  storage: Pick<Storage, "getItem"> = localStorage
): string | null {
  const key = getLastSpaceStorageKey(uid);
  if (!key) return null;

  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function persistActiveSpace(
  uid: string,
  spaceId: string,
  storage: Pick<Storage, "setItem"> = localStorage
): void {
  if (!spaceId) return;

  try {
    storage.setItem(CURRENT_SPACE_STORAGE_KEY, spaceId);
    const lastSpaceKey = getLastSpaceStorageKey(uid);
    if (lastSpaceKey) storage.setItem(lastSpaceKey, spaceId);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

export function resolveInitialSpace<T extends { space_id: string }>(
  spaces: T[],
  ...preferredSpaceIds: Array<string | null | undefined>
): T | undefined {
  for (const spaceId of preferredSpaceIds) {
    if (!spaceId) continue;
    const preferredSpace = spaces.find((space) => space.space_id === spaceId);
    if (preferredSpace) return preferredSpace;
  }

  return spaces[0];
}

export function resolveInitialSpaceForUser<T extends { space_id: string }>(
  spaces: T[],
  uid: string,
  activeSpaceId: string | null | undefined,
  storage: Pick<Storage, "getItem"> = localStorage
): T | undefined {
  let savedSpaceId: string | null = null;
  try {
    savedSpaceId = storage.getItem(CURRENT_SPACE_STORAGE_KEY);
  } catch {
    // The in-memory and fallback candidates still work without storage.
  }

  return resolveInitialSpace(
    spaces,
    activeSpaceId,
    savedSpaceId,
    readLastSpaceId(uid, storage)
  );
}
