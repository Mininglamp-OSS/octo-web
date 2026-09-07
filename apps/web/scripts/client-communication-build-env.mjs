export function resolveCommunicationBuildEnv(processEnv, viteEnv) {
  const resolveValue = (key) => processEnv[key] ?? viteEnv[key] ?? "";
  const apiURL = resolveValue("VITE_API_URL");
  const e2eMock = resolveValue("VITE_E2E_MOCK") === "1";
  const e2eMockIm = resolveValue("VITE_E2E_MOCK_IM") === "1";

  return {
    apiURL,
    e2eMock,
    e2eMockIm,
    viteEnv: {
      VITE_API_URL: apiURL,
      VITE_E2E_MOCK: e2eMock ? "1" : "0",
      VITE_E2E_MOCK_IM: e2eMockIm ? "1" : "0",
    },
  };
}
