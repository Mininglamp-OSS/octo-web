/** WuKongIM device slots: 1 = web, 2 = desktop PC. */
import StorageService from "./StorageService";

export const IM_DEVICE_FLAG_WEB = 1;
export const IM_DEVICE_FLAG_PC = 2;

const DEVICE_FLAG_MIGRATION_PREFIX = "octo.device-flag-migration.v1:";

function migrationKey(sid: string): string {
  return `${DEVICE_FLAG_MIGRATION_PREFIX}${sid}`;
}

/** Mark a legacy desktop session as having entered the one-shot migration. */
export function markDeviceFlagMigration(sid: string): void {
  if (sid) StorageService.shared.setPersistentItem(migrationKey(sid), "1");
}

export function hasDeviceFlagMigration(sid: string): boolean {
  return Boolean(sid && StorageService.shared.getPersistentItem(migrationKey(sid)) === "1");
}

/** A new authenticated session owns the SID again, so its old marker is stale. */
export function clearDeviceFlagMigration(sid: string): void {
  if (sid) StorageService.shared.removePersistentItem(migrationKey(sid));
}

export function getExpectedImDeviceFlag(isPC: boolean): number {
  return isPC ? IM_DEVICE_FLAG_PC : IM_DEVICE_FLAG_WEB;
}

export function hasImDeviceFlagMismatch(
  isLogined: boolean,
  storedDeviceFlag: number | undefined,
  expectedDeviceFlag: number,
): boolean {
  return isLogined && storedDeviceFlag !== expectedDeviceFlag;
}
