export async function runLogoutCleanup(
  clearLocalLoginState: () => void | Promise<void>,
  clearElectronAuthSession: () => void | Promise<void>,
): Promise<void> {
  await clearLocalLoginState();
  await clearElectronAuthSession();
}
