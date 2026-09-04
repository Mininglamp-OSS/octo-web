import { describe, expect, it } from "vitest";
import { resolveClientFeatureBuildEnv } from "../scripts/client-feature-build-env.mjs";

describe("client feature build environment", () => {
  it("prefers explicit process values over loaded Vite values", () => {
    expect(
      resolveClientFeatureBuildEnv(
        { VITE_API_URL: "https://process.example", VITE_E2E_MOCK: "1" },
        {
          VITE_API_URL: "https://vite.example",
          VITE_E2E_MOCK: "0",
          VITE_E2E_MOCK_IM: "1",
        }
      )
    ).toEqual({
      apiURL: "https://process.example",
      e2eMock: true,
      e2eMockIm: true,
      viteEnv: {
        VITE_API_URL: "https://process.example",
        VITE_E2E_MOCK: "1",
        VITE_E2E_MOCK_IM: "1",
      },
    });
  });
});
