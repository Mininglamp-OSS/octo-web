export function shouldPublishInitialSpaceChange(
  previousSpaceId: string,
  nextSpaceId: string
): boolean {
  return nextSpaceId !== "" && previousSpaceId !== nextSpaceId;
}

export function requestGuardedSpaceChange(
  nextSpaceId: string,
  currentSpaceId: string,
  requestSwitch: (apply: () => void) => boolean,
  apply: (spaceId: string) => void
): boolean {
  if (nextSpaceId === currentSpaceId) {
    return true;
  }
  return requestSwitch(() => apply(nextSpaceId));
}

export function resolveInitialSpace<T extends { space_id: string }>(
  spaces: T[],
  savedSpaceId: string | null
): T | undefined {
  return (
    (savedSpaceId
      ? spaces.find((space) => space.space_id === savedSpaceId)
      : undefined) ?? spaces[0]
  );
}
