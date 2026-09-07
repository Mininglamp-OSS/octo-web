import { describe, expect, it } from "vitest";
import { resolveCommunicationBuildEnv } from "../../scripts/client-communication-build-env.mjs";

describe("resolveCommunicationBuildEnv", () => {
  it("uses Vite-loaded mock flags when process env is unset", () => {
    const result = resolveCommunicationBuildEnv(
      {},
      {
        VITE_API_URL: "https://im.example.test",
        VITE_E2E_MOCK_IM: "1",
      }
    );

    expect(result).toEqual({
      apiURL: "https://im.example.test",
      e2eMock: false,
      e2eMockIm: true,
      viteEnv: {
        VITE_API_URL: "https://im.example.test",
        VITE_E2E_MOCK: "0",
        VITE_E2E_MOCK_IM: "1",
      },
    });
  });

  it("uses process env as the explicit override", () => {
    const result = resolveCommunicationBuildEnv(
      {
        VITE_API_URL: "https://override.example.test",
        VITE_E2E_MOCK: "0",
        VITE_E2E_MOCK_IM: "0",
      },
      {
        VITE_API_URL: "https://file.example.test",
        VITE_E2E_MOCK: "1",
        VITE_E2E_MOCK_IM: "1",
      }
    );

    expect(result.e2eMock).toBe(false);
    expect(result.e2eMockIm).toBe(false);
    expect(result.viteEnv).toEqual({
      VITE_API_URL: "https://override.example.test",
      VITE_E2E_MOCK: "0",
      VITE_E2E_MOCK_IM: "0",
    });
  });
});
