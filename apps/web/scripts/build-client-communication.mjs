import { buildClientFeature } from "./client-feature-build.mjs";

void buildClientFeature({
  scriptUrl: import.meta.url,
  featureId: "communication",
  artifactName: "octo-web-client-communication",
  configFile: "vite.client-communication.config.ts",
  sourceEntry: "client-communication.html",
  outputDirectory: "build-client-communication",
  contractRevision: 3,
  documentForwardVersion: 1,
  includeImMock: true,
}).catch((error) => {
  console.error(`[build-client-communication] failed: ${error.message}`);
  process.exit(1);
});
