export function shouldPublishInitialSpaceChange(
  previousSpaceId: string,
  nextSpaceId: string
): boolean {
  return nextSpaceId !== "" && previousSpaceId !== nextSpaceId;
}

export function publishInitialSpaceResolution<T extends { space_id: string }>(
  previousSpaceId: string,
  selectedSpace: T | undefined,
  emit: (event: "space-changed" | "space-ready", space: T) => void
): void {
  if (!selectedSpace) return;

  if (
    shouldPublishInitialSpaceChange(previousSpaceId, selectedSpace.space_id)
  ) {
    emit("space-changed", selectedSpace);
  }

  // `space-changed` only describes a real switch. Consumers that need one
  // authenticated cold-start signal subscribe to this non-destructive event.
  emit("space-ready", selectedSpace);
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
