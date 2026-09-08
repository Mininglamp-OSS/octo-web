export function resolveClientFeatureBuildEnv(processEnv, viteEnv) {
  const resolveValue = (key) => processEnv[key] ?? viteEnv[key] ?? "";
  const apiURL = resolveValue("VITE_API_URL");
  const e2eMock = resolveValue("VITE_E2E_MOCK") === "1";
  const e2eMockIm = resolveValue("VITE_E2E_MOCK_IM") === "1";
  const resolvedMock = e2eMock || e2eMockIm;

  if (resolvedMock && processEnv.OCTO_ALLOW_MOCK_CLIENT_ARTIFACT !== "1") {
    throw new Error(
      "mock artifact builds require OCTO_ALLOW_MOCK_CLIENT_ARTIFACT=1; " +
        "set it in the environment to confirm the mock state is intentional"
    );
  }

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
