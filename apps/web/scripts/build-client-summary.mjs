import { buildClientFeature } from "./client-feature-build.mjs";

void buildClientFeature({
  scriptUrl: import.meta.url,
  featureId: "summary",
  artifactName: "octo-web-client-summary",
  configFile: "vite.client-summary.config.ts",
  sourceEntry: "client-summary.html",
  outputDirectory: "build-client-summary",
  contractRevision: 2,
}).catch((error) => {
  console.error(`[build-client-summary] failed: ${error.message}`);
  process.exit(1);
});
