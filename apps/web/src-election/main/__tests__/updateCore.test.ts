import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildMacInstallScript,
  buildUpdaterCheckUrl,
  getDownloadedUpdateFileName,
  getMacAppBundleName,
  getMacAppBundlePath,
  getUpdaterPlatform,
  isAllowedUpdaterPackageUrl,
  isNewerVersion,
  isZipUpdatePackage,
  parseUpdaterCheckResult,
  parseUpdateInfo,
} from "../updateCore";

const SHA512_HEX = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

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
    })).toThrow("Updater API URL must be https");
    expect(() => buildUpdaterCheckUrl({
      updaterApiUrl: "http://updates.example.test/api/",
      version: "1.0.0",
      platform: "darwin",
    })).toThrow("Updater API URL must be https");
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
        sha512: SHA512_HEX,
        force_update: true,
      }),
    ).toEqual({
      version: "1.0.0",
      url: "https://cdn.example.com/OCTO-Setup-1.0.0.exe",
      notes: "Windows update",
      pub_date: "2026-08-20T00:00:00Z",
      sha256: "",
      sha512: SHA512_HEX,
      forceUpdate: true,
    });
  });

  it("accepts updater download URL aliases and common force update fields", () => {
    expect(
      parseUpdateInfo({
        version: "1.0.0",
        download_url: "https://cdn.example.com/OCTO-1.0.0-arm64.dmg",
        sha512: SHA512_HEX,
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
          downloadUrl: "https://cdn.example.com/OCTO-1.0.1-universal.zip",
          sha512: SHA512_HEX,
        },
      }, { platform: "darwin" }),
    ).toMatchObject({
      version: "1.0.1",
      url: "https://cdn.example.com/OCTO-1.0.1-universal.zip",
    });
  });

  it("treats explicit no-update payloads as no update", () => {
    expect(parseUpdaterCheckResult({ should_update: false })).toBeNull();
    expect(parseUpdaterCheckResult({ data: { hasUpdate: "False" } })).toBeNull();
    expect(parseUpdaterCheckResult({ data: null })).toBeNull();
    expect(parseUpdaterCheckResult({ code: 0, msg: "ok" })).toBeNull();
  });

  it("rejects non-https updater manifest URLs by default", () => {
    expect(() => parseUpdateInfo({ version: "1.0.0", url: "http://cdn.example.com/app.zip", sha512: SHA512_HEX })).toThrow(
      "Updater response url must be https",
    );
  });

  it("allows localhost http updater manifest URLs only when explicitly enabled", () => {
    expect(
      parseUpdateInfo(
        { version: "1.0.0", url: "http://127.0.0.1:9000/OCTO-1.0.0-universal.zip", sha512: SHA512_HEX },
        { allowInsecureHttp: true },
      ),
    ).toMatchObject({
      url: "http://127.0.0.1:9000/OCTO-1.0.0-universal.zip",
    });
    expect(() => parseUpdateInfo(
      { version: "1.0.0", url: "http://cdn.example.com/app.zip", sha512: SHA512_HEX },
      { allowInsecureHttp: true },
    )).toThrow("Updater response url must be https");
  });

  it("rejects updater manifest URLs that cannot be opened safely", () => {
    expect(() => parseUpdateInfo({ version: "1.0.0", url: "file:///tmp/app.exe", sha512: SHA512_HEX })).toThrow(
      "Updater response url must be https",
    );
  });

  it("rejects updater payloads without a package checksum", () => {
    expect(() => parseUpdateInfo({
      version: "1.0.0",
      url: "https://cdn.example.com/OCTO-1.0.0-universal.zip",
    })).toThrow("Updater response is missing package checksum");
  });

  it("does not guess that signature fields are package checksums", () => {
    expect(() => parseUpdateInfo({
      version: "1.0.0",
      url: "https://cdn.example.com/OCTO-1.0.0-universal.zip",
      signature: SHA512_HEX,
    })).toThrow("Updater response is missing package checksum");
  });

  it("rejects updater download URLs from a different origin when requested", () => {
    expect(() => parseUpdateInfo(
      { version: "1.0.0", url: "https://cdn.example.com/OCTO-1.0.0-universal.zip", sha512: SHA512_HEX },
      { platform: "darwin", expectedDownloadOrigin: "https://updates.example.test" },
    )).toThrow("Updater response url origin does not match updater API origin");
  });

  it("rejects updater package URLs that do not match the current platform", () => {
    expect(
      parseUpdateInfo(
        { version: "1.0.0", url: "https://cdn.example.com/OCTO-1.0.0-universal.zip", sha512: SHA512_HEX },
        { platform: "darwin" },
      ).url,
    ).toBe("https://cdn.example.com/OCTO-1.0.0-universal.zip");
    expect(() => parseUpdateInfo(
      { version: "1.0.0", url: "https://cdn.example.com/OCTO-1.0.0-universal.zip", sha512: SHA512_HEX },
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
      getDownloadedUpdateFileName("https://cdn.example.com/releases/OCTO-1.0.0-universal.zip", "1.0.0", "macos"),
    ).toBe("OCTO-1.0.0-universal.zip");
    expect(
      getDownloadedUpdateFileName("https://cdn.example.com/releases/", "1.0.0", "windows"),
    ).toBe("OCTO-1.0.0.exe");
    expect(
      getDownloadedUpdateFileName("https://cdn.example.com/releases/", "1.0.0", "macos"),
    ).toBe("OCTO-1.0.0.zip");
    expect(
      getDownloadedUpdateFileName("https://cdn.example.com/releases/OCTO-1.0.0;Start-Process.exe", "1.0.0", "windows"),
    ).toBe("OCTO-1.0.0_Start-Process.exe");
  });

  it("preserves updater package extensions when truncating long local filenames", () => {
    const longStem = `OCTO-${"a".repeat(190)}`;
    const windowsName = getDownloadedUpdateFileName(`https://cdn.example.com/releases/${longStem}.exe`, "1.0.0", "windows");
    const macName = getDownloadedUpdateFileName(`https://cdn.example.com/releases/${longStem}.zip`, "1.0.0", "macos");
    expect(windowsName).toHaveLength(160);
    expect(windowsName).toMatch(/\.exe$/);
    expect(macName).toHaveLength(160);
    expect(macName).toMatch(/\.zip$/);
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

  it("compares simple release versions", () => {
    expect(isNewerVersion("1.0.1", "1.0.0")).toBe(true);
    expect(isNewerVersion("v1.2.0", "1.1.9")).toBe(true);
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("1.0.0", "1.0.1")).toBe(false);
    expect(isNewerVersion("1.0.0-rollback", "1.2.0")).toBe(false);
  });

  it("executes the macOS installer script and writes failure output to argv 10 and 11", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "octo-updater-script-"));
    try {
      const scriptPath = path.join(tempDir, "install-macos-update.sh");
      const zipPath = path.join(tempDir, "OCTO-1.0.1.zip");
      const targetAppPath = path.join(tempDir, "OCTO.app");
      const stagingPath = path.join(tempDir, "staging");
      const installDir = path.join(tempDir, "install");
      const resultPath = path.join(tempDir, "last-macos-update-result.txt");
      const logPath = path.join(tempDir, "last-macos-update.log");
      fs.writeFileSync(scriptPath, buildMacInstallScript(), { mode: 0o700 });
      fs.writeFileSync(zipPath, "");

      expect(() => execFileSync("/bin/sh", [
        scriptPath,
        zipPath,
        targetAppPath,
        stagingPath,
        "999999",
        "com.mininglamp.octo.web",
        "OCTO.app",
        "1.0.1",
        "TEAMID1234",
        installDir,
        resultPath,
        logPath,
      ], { stdio: "ignore" })).toThrow();

      expect(fs.readFileSync(resultPath, "utf8").trim()).toBe("12");
      expect(fs.existsSync(logPath)).toBe(true);
      expect(fs.existsSync(`${zipPath}0`)).toBe(false);
      expect(fs.existsSync(`${zipPath}1`)).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
