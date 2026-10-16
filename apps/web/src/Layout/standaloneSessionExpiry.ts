import { clearSessionsWithToken } from "./recoverSession";

interface ExpiringLogin {
  token?: string;
  logout(): void | Promise<void>;
}

/** Clear token buckets synchronously, then finish draft revocation before reload. */
export async function expireStandaloneSession(
  login: ExpiringLogin,
  target: Pick<Window, "sessionStorage" | "localStorage"> & { location: Pick<Location, "reload"> }
): Promise<void> {
  const token = login.token || "";
  const cleanup = login.logout();
  if (token) clearSessionsWithToken(token, target.sessionStorage, target.localStorage);
  await cleanup;
  target.location.reload();
}
