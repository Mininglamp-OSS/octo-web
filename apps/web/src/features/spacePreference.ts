const CURRENT_SPACE_STORAGE_KEY = "currentSpaceId";
const LAST_SPACE_STORAGE_PREFIX = "octo:last-space:";
const LEGACY_SPACE_MIGRATION_KEY = "octo:last-space-legacy-migration:v1";

type SpacePreferenceReader = Pick<Storage, "getItem"> &
  Partial<Pick<Storage, "setItem">>;

export function getLastSpaceStorageKey(
  uid: string | null | undefined
): string | undefined {
  const normalizedUid = typeof uid === "string" ? uid.trim() : "";
  if (!normalizedUid) return undefined;
  return `${LAST_SPACE_STORAGE_PREFIX}${encodeURIComponent(normalizedUid)}`;
}

export function readLastSpaceId(
  uid: string | null | undefined,
  store: SpacePreferenceReader = localStorage
): string | null {
  const key = getLastSpaceStorageKey(uid);
  if (!key) return null;

  try {
    const lastSpaceId = store.getItem(key);
    if (lastSpaceId) {
      // Once UID-scoped data exists, the legacy global key must never be
      // adopted by another account on this device.
      try {
        store.setItem?.(LEGACY_SPACE_MIGRATION_KEY, "1");
      } catch {
        // The UID-scoped value is still safe to read when storage is read-only.
      }
      return lastSpaceId;
    }

    if (
      store.getItem(LEGACY_SPACE_MIGRATION_KEY) !== null ||
      !store.setItem
    ) {
      return null;
    }

    const legacySpaceId = store.getItem(CURRENT_SPACE_STORAGE_KEY);

    // Mark first so an interrupted migration cannot let a later account
    // inherit the same global value. The selected Space is still validated
    // against /space/my before it is entered.
    store.setItem(LEGACY_SPACE_MIGRATION_KEY, "1");
    if (legacySpaceId) {
      try {
        store.setItem(key, legacySpaceId);
      } catch {
        // The legacy value remains valid for this session. The marker prevents
        // it from being adopted by a different uid later.
      }
    }

    return legacySpaceId;
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
