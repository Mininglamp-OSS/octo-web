import { t } from "@octo/base";

/** Server errors are diagnostic text, not localized product copy. */
export function publicationErrorMessage(error: unknown, fallbackKey: string): string {
  const value = error as { status?: number; response?: { status?: number } } | null;
  const status = value?.status ?? value?.response?.status;
  if (status === 409) return t("skillMarket.publication.updatesConflict");
  if (status === 403) return t("skillMarket.publication.permissionDenied");
  if (status === 404) return t("skillMarket.publication.resourceUnavailable");
  return t(fallbackKey);
}
