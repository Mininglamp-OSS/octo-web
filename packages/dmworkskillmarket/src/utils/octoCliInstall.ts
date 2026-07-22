export type OctoCliDistTag = "latest" | "next";

export function getOctoCliInstallCommand(override?: OctoCliDistTag): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  const configured = override || env?.VITE_OCTO_CLI_DIST_TAG;
  const tag: OctoCliDistTag = configured === "next" ? "next" : "latest";
  return `npm install -g @mininglamp-oss/octo-cli@${tag}`;
}
