export type ClientFeatureId = "communication" | "summary" | "apps";

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function requireString(
  value: unknown,
  label: string,
  options: { allowEmpty?: boolean } = {}
): string {
  if (typeof value !== "string" || (!options.allowEmpty && !value.trim())) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

export function assertClientFeatureBootstrap(
  value: unknown,
  expectedFeatureId: ClientFeatureId
): void {
  const bootstrap = asRecord(value, "feature bootstrap");
  if (bootstrap.bridgeVersion !== 1) {
    throw new Error(`Unsupported ${expectedFeatureId} bridge version`);
  }
  if (bootstrap.featureId !== expectedFeatureId) {
    throw new Error(`Unexpected feature bootstrap: ${String(bootstrap.featureId)}`);
  }

  const session = asRecord(bootstrap.session, "feature session");
  requireString(session.uid, "feature session uid");
  requireString(session.token, "feature session token");
  requireString(session.name, "feature session name", { allowEmpty: true });
  requireString(session.provider, "feature session provider");
  const apiOrigin = requireString(session.apiOrigin, "feature session apiOrigin");
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(apiOrigin);
  } catch {
    throw new Error("feature session apiOrigin is invalid");
  }
  if (parsedOrigin.protocol !== "https:" && parsedOrigin.protocol !== "http:") {
    throw new Error("feature session apiOrigin is invalid");
  }
  if (session.email !== undefined && typeof session.email !== "string") {
    throw new Error("feature session email is invalid");
  }

  const space = asRecord(bootstrap.space, "feature space");
  requireString(space.id, "feature space id");
  requireString(space.name, "feature space name", { allowEmpty: true });

  const appearance = asRecord(bootstrap.appearance, "feature appearance");
  if (appearance.theme !== "light" && appearance.theme !== "dark") {
    throw new Error("feature appearance theme is invalid");
  }
  if (appearance.locale !== "zh-CN" && appearance.locale !== "en-US") {
    throw new Error("feature appearance locale is invalid");
  }
}
