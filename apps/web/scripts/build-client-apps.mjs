import { buildClientFeature } from "./client-feature-build.mjs";

void buildClientFeature({
  scriptUrl: import.meta.url,
  featureId: "apps",
  artifactName: "octo-web-client-apps",
  configFile: "vite.client-apps.config.ts",
  sourceEntry: "client-apps.html",
  outputDirectory: "build-client-apps",
}).catch((error) => {
  console.error(`[build-client-apps] failed: ${error.message}`);
  process.exit(1);
});
