import { resolveClientFeatureBuildEnv } from "./client-feature-build-env.mjs";

export function resolveCommunicationBuildEnv(processEnv, viteEnv) {
  return resolveClientFeatureBuildEnv(processEnv, viteEnv);
}
