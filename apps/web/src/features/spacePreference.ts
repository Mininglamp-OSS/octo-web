const CURRENT_SPACE_STORAGE_KEY = "currentSpaceId";
const LAST_SPACE_STORAGE_PREFIX = "octo:last-space:";

export function getLastSpaceStorageKey(
  uid: string | null | undefined
): string | undefined {
  const normalizedUid = typeof uid === "string" ? uid.trim() : "";
  if (!normalizedUid) return undefined;
  return `${LAST_SPACE_STORAGE_PREFIX}${encodeURIComponent(normalizedUid)}`;
}

export function readLastSpaceId(
  uid: string | null | undefined,
  store: Pick<Storage, "getItem"> = localStorage
): string | null {
  const key = getLastSpaceStorageKey(uid);
  if (!key) return null;

  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

export function persistActiveSpace(
  uid: string | null | undefined,
  spaceId: string,
  store: Pick<Storage, "setItem"> = localStorage
): void {
  if (!spaceId) return;

  try {
    store.setItem(CURRENT_SPACE_STORAGE_KEY, spaceId);
    const lastSpaceKey = getLastSpaceStorageKey(uid);
    if (lastSpaceKey) store.setItem(lastSpaceKey, spaceId);
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
  uid: string | null | undefined,
  activeSpaceId: string | null | undefined,
  store: Pick<Storage, "getItem"> = localStorage
): T | undefined {
  return resolveInitialSpace(
    spaces,
    activeSpaceId,
    readLastSpaceId(uid, store)
  );
}
