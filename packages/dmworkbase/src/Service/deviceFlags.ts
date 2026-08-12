/** WuKongIM device slots: 1 = web, 2 = desktop PC. */
export const IM_DEVICE_FLAG_WEB = 1;
export const IM_DEVICE_FLAG_PC = 2;

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
