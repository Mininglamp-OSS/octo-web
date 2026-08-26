import { describe, expect, it } from "vitest";
import { parseOidcProviders } from "../OidcConfig";

describe("parseOidcProviders authorize_path safety", () => {
  it("rejects URL-normalized control characters and query delimiters", () => {
    const unsafePaths = [
      "/\tevil.example.com/authorize",
      "/\nevil.example.com/authorize",
      "/\revil.example.com/authorize",
      "/v1/auth/oidc/acme/authorize?tenant=x",
      "/v1/auth/oidc/acme/authorize#fragment",
    ];

    for (const authorize_path of unsafePaths) {
      expect(
        parseOidcProviders([{ id: "acme", name: "Acme", authorize_path }])
      ).toEqual([]);
    }
  });

  it("accepts a normal server-relative authorize path", () => {
    expect(
      parseOidcProviders([
        {
          id: "acme",
          name: "Acme",
          authorize_path: "/v1/auth/oidc/acme/authorize",
        },
      ])
    ).toHaveLength(1);
  });
});
