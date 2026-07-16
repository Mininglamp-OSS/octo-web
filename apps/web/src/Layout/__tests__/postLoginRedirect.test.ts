import { describe, expect, it } from "vitest";

import { buildPostLoginRedirectUrl } from "../postLoginRedirect";

describe("buildPostLoginRedirectUrl", () => {
  it("keeps Electron on the packaged index file after login", () => {
    expect(
      buildPostLoginRedirectUrl(
        "file:///Applications/OCTO.app/Contents/Resources/app.asar/build/index.html?sid=old",
        "null",
        "/Applications/OCTO.app/Contents/Resources/app.asar/build",
        "?doc=d_1"
      )
    ).toBe(
      "file:///Applications/OCTO.app/Contents/Resources/app.asar/build/index.html?doc=d_1"
    );
  });

  it("keeps the existing web redirect behavior", () => {
    expect(
      buildPostLoginRedirectUrl(
        "https://octo.example.com/login?sid=old",
        "https://octo.example.com",
        "",
        "?doc=d_1"
      )
    ).toBe("https://octo.example.com/?doc=d_1");
  });
});
