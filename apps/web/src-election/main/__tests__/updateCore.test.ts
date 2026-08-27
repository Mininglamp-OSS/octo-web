import { describe, expect, it } from "vitest";
import {
  buildUpdaterCheckUrl,
  getDownloadedUpdateFileName,
  getMacAppBundleName,
  getMacAppBundlePath,
  getUpdaterPlatform,
  isAllowedUpdaterPackageUrl,
  isZipUpdatePackage,
  parseUpdaterCheckResult,
  parseUpdateInfo,
} from "../updateCore";

describe("desktop updater core", () => {
  it("maps Electron platforms to updater system path segments", () => {
    expect(getUpdaterPlatform("darwin")).toBe("macos");
    expect(getUpdaterPlatform("win32")).toBe("windows");
    expect(getUpdaterPlatform("linux")).toBe("linux");
  });

  it("builds macOS updater check URLs", () => {
    expect(
      buildUpdaterCheckUrl({
        updaterApiUrl: "https://updates.example.test/api/v1/common/updater/",
        version: "1.0.0",
        platform: "darwin",
      }),
    ).toBe("https://updates.example.test/api/v1/common/updater/macos/1.0.0");
  });

  it("builds Windows updater check URLs", () => {
    expect(
      buildUpdaterCheckUrl({
        updaterApiUrl: "https://updates.example.test/api/v1/common/updater",
        version: "0.1.0",
        platform: "win32",
      }),
    ).toBe("https://updates.example.test/api/v1/common/updater/windows/0.1.0");
  });

  it("rejects invalid updater API base URLs", () => {
    expect(() => buildUpdaterCheckUrl({
      updaterApiUrl: "not-a-url",
      version: "1.0.0",
      platform: "darwin",
    })).toThrow();
    expect(() => buildUpdaterCheckUrl({
      updaterApiUrl: "file:///tmp/updater/",
      version: "1.0.0",
      platform: "darwin",
    })).toThrow("Updater API URL must be http(s)");
    expect(() => buildUpdaterCheckUrl({
      updaterApiUrl: "https://updates.example.test/api?token=abc",
      version: "1.0.0",
      platform: "darwin",
    })).toThrow("Updater API URL must not include query or hash");
  });

  it("accepts https updater manifest URLs", () => {
    expect(
      parseUpdateInfo({
        version: "1.0.0",
        url: " https://cdn.example.com/OCTO-Setup-1.0.0.exe ",
        notes: "Windows update",
        pub_date: "2026-08-20T00:00:00Z",
        force_update: true,
      }),
    ).toEqual({
      version: "1.0.0",
      url: "https://cdn.example.com/OCTO-Setup-1.0.0.exe",
      notes: "Windows update",
      pub_date: "2026-08-20T00:00:00Z",
      signature: "",
      forceUpdate: true,
    });
  });

  it("accepts updater download URL aliases and common force update fields", () => {
    expect(
      parseUpdateInfo({
        version: "1.0.0",
        download_url: "https://cdn.example.com/OCTO-1.0.0-arm64.dmg",
        mandatory: "TRUE",
      }),
    ).toMatchObject({
      url: "https://cdn.example.com/OCTO-1.0.0-arm64.dmg",
      forceUpdate: true,
    });
  });

  it("unwraps API envelope responses before parsing update info", () => {
    expect(
      parseUpdaterCheckResult({
        data: {
          version: "1.0.1",
          downloadUrl: "https://cdn.example.com/OCTO-1.0.1-arm64.dmg",
        },
      }),
    ).toMatchObject({
      version: "1.0.1",
      url: "https://cdn.example.com/OCTO-1.0.1-arm64.dmg",
    });
  });

  it("treats explicit no-update payloads as no update", () => {
    expect(parseUpdaterCheckResult({ should_update: false })).toBeNull();
    expect(parseUpdaterCheckResult({ data: { hasUpdate: "False" } })).toBeNull();
    expect(parseUpdaterCheckResult({ data: null })).toBeNull();
  });

  it("rejects non-https updater manifest URLs by default", () => {
    expect(() => parseUpdateInfo({ version: "1.0.0", url: "http://cdn.example.com/app.zip" })).toThrow(
      "Updater response url must be https",
    );
  });

  it("allows localhost http updater manifest URLs only when explicitly enabled", () => {
    expect(
      parseUpdateInfo(
        { version: "1.0.0", url: "http://127.0.0.1:9000/OCTO-1.0.0-universal.zip" },
        { allowInsecureHttp: true },
      ),
    ).toMatchObject({
      url: "http://127.0.0.1:9000/OCTO-1.0.0-universal.zip",
    });
    expect(() => parseUpdateInfo(
      { version: "1.0.0", url: "http://cdn.example.com/app.zip" },
      { allowInsecureHttp: true },
    )).toThrow("Updater response url must be https");
  });

  it("rejects updater manifest URLs that cannot be opened safely", () => {
    expect(() => parseUpdateInfo({ version: "1.0.0", url: "file:///tmp/app.exe" })).toThrow(
      "Updater response url must be https",
    );
  });

  it("rejects updater package URLs that do not match the current platform", () => {
    expect(
      parseUpdateInfo(
        { version: "1.0.0", url: "https://cdn.example.com/OCTO-1.0.0-universal.zip" },
        { platform: "darwin" },
      ).url,
    ).toBe("https://cdn.example.com/OCTO-1.0.0-universal.zip");
    expect(() => parseUpdateInfo(
      { version: "1.0.0", url: "https://cdn.example.com/OCTO-1.0.0-universal.zip" },
      { platform: "win32" },
    )).toThrow("Updater response url extension does not match current platform");
  });

  it("allows only expected updater package extensions per platform", () => {
    expect(isAllowedUpdaterPackageUrl(new URL("https://cdn.example.com/OCTO.dmg"), "macos")).toBe(false);
    expect(isAllowedUpdaterPackageUrl(new URL("https://cdn.example.com/OCTO.zip"), "macos")).toBe(true);
    expect(isAllowedUpdaterPackageUrl(new URL("https://cdn.example.com/OCTO.exe"), "macos")).toBe(false);
    expect(isAllowedUpdaterPackageUrl(new URL("https://cdn.example.com/OCTO.exe"), "windows")).toBe(true);
  });

  it("builds safe local filenames for downloaded update packages", () => {
    expect(
      getDownloadedUpdateFileName("https://cdn.example.com/releases/OCTO-1.0.0-arm64.dmg", "1.0.0", "macos"),
    ).toBe("OCTO-1.0.0-arm64.dmg");
    expect(
      getDownloadedUpdateFileName("https://cdn.example.com/releases/", "1.0.0", "windows"),
    ).toBe("OCTO-1.0.0.exe");
    expect(
      getDownloadedUpdateFileName("https://cdn.example.com/releases/", "1.0.0", "macos"),
    ).toBe("OCTO-1.0.0.zip");
  });

  it("detects zip update packages", () => {
    expect(isZipUpdatePackage("https://cdn.example.com/OCTO-1.0.0-universal.zip")).toBe(true);
    expect(isZipUpdatePackage("/Users/me/Library/Application Support/OCTO/updates/OCTO-1.0.0-universal.zip")).toBe(true);
    expect(isZipUpdatePackage("https://cdn.example.com/OCTO-1.0.0-universal.dmg")).toBe(false);
  });

  it("resolves the owning macOS app bundle from the executable path", () => {
    expect(getMacAppBundlePath("/Applications/OCTO.app/Contents/MacOS/OCTO")).toBe("/Applications/OCTO.app");
    expect(getMacAppBundlePath("/Users/me/Downloads/OCTO.app/Contents/MacOS/OCTO")).toBe("/Users/me/Downloads/OCTO.app");
  });

  it("resolves the macOS app bundle name", () => {
    expect(getMacAppBundleName("/Applications/OCTO.app")).toBe("OCTO.app");
    expect(() => getMacAppBundleName("/Applications/OCTO")).toThrow("macOS app bundle path must end with .app");
  });
});
