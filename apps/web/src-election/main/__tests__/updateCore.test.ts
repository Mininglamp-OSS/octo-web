import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildLinuxAppImageInstallPlan,
  buildMacInstallScript,
  buildUpdaterCheckUrl,
  buildWindowsInstallerSignatureCommand,
  getDownloadedUpdateFileName,
  getMacAppBundleName,
  getMacAppBundlePath,
  getMacExpectedMachOArch,
  getUpdaterPlatform,
  isAllowedUpdaterPackageUrl,
  isLinuxElfMachineCompatible,
  isNewerVersion,
  parseLinuxElfMachine,
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
    expect(parseUpdateInfo({
      version: "1.0.0",
      download_url: "https://cdn.example.com/OCTO-1.0.0-arm64.dmg",
      sha512: SHA512_HEX,
      is_force: 1,
    })).toMatchObject({
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

  it("accepts the live updater endpoint signature field as a sha512 digest", () => {
    expect(parseUpdateInfo({
      version: "1.0.0",
      url: "https://updates.example.test/releases/OCTO-1.0.0-universal.zip",
      notes: "Desktop update",
      pub_date: "2026-08-28T08:00:00Z",
      signature: SHA512_HEX,
    }, {
      platform: "darwin",
      expectedDownloadOrigin: "https://updates.example.test",
    })).toMatchObject({
      version: "1.0.0",
      url: "https://updates.example.test/releases/OCTO-1.0.0-universal.zip",
      sha512: SHA512_HEX,
    });
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

  it("sanitizes fallback stems even when the server URL basename is empty", () => {
    expect(
      getDownloadedUpdateFileName("https://cdn.example.com/releases/%20.exe", "../../../../evil", "windows"),
    ).toBe("OCTO-.._.._.._.._evil.exe");
  });

  it("builds Linux AppImage replacement paths from the running image", () => {
    expect(buildLinuxAppImageInstallPlan("/home/me/OCTO.AppImage")).toEqual({
      targetPath: "/home/me/OCTO.AppImage",
      stagingPath: "/home/me/OCTO.AppImage.update-in-progress",
      backupPath: "/home/me/OCTO.AppImage.previous-update",
    });
    expect(() => buildLinuxAppImageInstallPlan("")).toThrow("Running AppImage path is not available");
    expect(() => buildLinuxAppImageInstallPlan("/home/me/OCTO.deb")).toThrow("Running AppImage path must end with .AppImage");
  });

  it("parses Linux ELF machine headers for AppImage architecture checks", () => {
    const x64Header = new Uint8Array(20);
    x64Header.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
    x64Header[18] = 62;
    x64Header[19] = 0;
    const arm64Header = new Uint8Array(20);
    arm64Header.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
    arm64Header[18] = 183;
    arm64Header[19] = 0;

    expect(parseLinuxElfMachine(x64Header)).toBe(62);
    expect(parseLinuxElfMachine(arm64Header)).toBe(183);
    expect(isLinuxElfMachineCompatible(62, "x64")).toBe(true);
    expect(isLinuxElfMachineCompatible(183, "arm64")).toBe(true);
    expect(isLinuxElfMachineCompatible(62, "arm64")).toBe(false);
    expect(parseLinuxElfMachine(new Uint8Array([0x00, 0x45, 0x4c, 0x46]))).toBeUndefined();
  });

  it("resolves the owning macOS app bundle from the executable path", () => {
    expect(getMacAppBundlePath("/Applications/OCTO.app/Contents/MacOS/OCTO")).toBe("/Applications/OCTO.app");
    expect(getMacAppBundlePath("/Users/me/Downloads/OCTO.app/Contents/MacOS/OCTO")).toBe("/Users/me/Downloads/OCTO.app");
  });

  it("resolves the macOS app bundle name", () => {
    expect(getMacAppBundleName("/Applications/OCTO.app")).toBe("OCTO.app");
    expect(() => getMacAppBundleName("/Applications/OCTO")).toThrow("macOS app bundle path must end with .app");
  });

  it("maps Node architectures to macOS Mach-O slice names", () => {
    expect(getMacExpectedMachOArch("arm64")).toBe("arm64");
    expect(getMacExpectedMachOArch("x64")).toBe("x86_64");
    expect(() => getMacExpectedMachOArch("ia32")).toThrow("Unsupported macOS updater architecture");
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
      const psPath = path.join(tempDir, "ps-stub.sh");
      const zipPath = path.join(tempDir, "OCTO-1.0.1.zip");
      const targetAppPath = path.join(tempDir, "OCTO.app");
      const stagingPath = path.join(tempDir, "staging");
      const installDir = path.join(tempDir, "install");
      const resultPath = path.join(tempDir, "last-macos-update-result.txt");
      const logPath = path.join(tempDir, "last-macos-update.log");
      fs.writeFileSync(scriptPath, buildMacInstallScript(), { mode: 0o700 });
      fs.writeFileSync(psPath, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
      fs.writeFileSync(zipPath, "");

      // Linux runners intentionally fail at /usr/bin/ditto, so this test is scoped to
      // exercising the shell template and the two-digit argv plumbing.
      expect(() => execFileSync("/bin/sh", [
        scriptPath,
        zipPath,
        targetAppPath,
        stagingPath,
        String(process.pid + 10_000_000),
        "com.mininglamp.octo.web",
        "OCTO.app",
        "1.0.1",
        "TEAMID1234",
        installDir,
        resultPath,
        logPath,
        psPath,
        "x86_64",
      ], {
        stdio: "ignore",
        timeout: 30_000,
      })).toThrow();

      expect(fs.readFileSync(resultPath, "utf8").trim()).toBe("12");
      expect(fs.existsSync(logPath)).toBe(true);
      expect(fs.existsSync(`${zipPath}0`)).toBe(false);
      expect(fs.existsSync(`${zipPath}1`)).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("waits for a running macOS app path using literal matching when the path contains regex characters", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "octo-updater-wait-"));
    let scriptProcess: import("node:child_process").ChildProcess | undefined;
    try {
      const targetAppPath = path.join(tempDir, `Downloads-${"long-path-".repeat(8)}`, "OCTO back\\slash (Beta) [test].app");
      const scriptPath = path.join(tempDir, "install-macos-update.sh");
      const psPath = path.join(tempDir, "ps-stub.sh");
      const runningFlagPath = path.join(tempDir, "app-running");
      const zipPath = path.join(tempDir, "OCTO-1.0.1.zip");
      const stagingPath = path.join(tempDir, "staging");
      const installDir = path.join(tempDir, "install");
      const resultPath = path.join(tempDir, "last-macos-update-result.txt");
      const logPath = path.join(tempDir, "last-macos-update.log");
      fs.writeFileSync(scriptPath, buildMacInstallScript(), { mode: 0o700 });
      fs.writeFileSync(psPath, [
        "#!/bin/sh",
        "if [ \"$1\" != \"-axww\" ] || [ \"$2\" != \"-o\" ] || [ \"$3\" != \"command=\" ]; then",
        "  exit 2",
        "fi",
        `if [ -f "${runningFlagPath}" ]; then`,
        `  printf "%s\\n" "${targetAppPath}/Contents/MacOS/OCTO --flag"`,
        "fi",
      ].join("\n"), { mode: 0o700 });
      fs.writeFileSync(runningFlagPath, "");
      fs.writeFileSync(zipPath, "");

      const { spawn: spawnProcess } = await import("node:child_process");
      scriptProcess = spawnProcess("/bin/sh", [
        scriptPath,
        zipPath,
        targetAppPath,
        stagingPath,
        String(process.pid + 10_000_000),
        "com.mininglamp.octo.web",
        "OCTO (Beta) [test].app",
        "1.0.1",
        "TEAMID1234",
        installDir,
        resultPath,
        logPath,
        psPath,
        "x86_64",
      ], {
        stdio: "ignore",
      });

      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(fs.existsSync(resultPath)).toBe(false);
      fs.rmSync(runningFlagPath, { force: true });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("installer script did not finish")), 30_000);
        scriptProcess?.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
        scriptProcess?.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
      expect(fs.readFileSync(resultPath, "utf8").trim()).toBe("12");
    } finally {
      scriptProcess?.kill();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps the macOS rollback backup until a later launch and checks executable architecture", () => {
    const script = buildMacInstallScript();
    const finalSwapIndex = script.indexOf('if ! /bin/mv "$INSTALL_TARGET_TMP_PATH" "$TARGET_APP_PATH"; then');
    expect(script).toContain('NEXT_EXECUTABLE_NAME="$(/usr/libexec/PlistBuddy -c "Print :CFBundleExecutable"');
    expect(script).toContain('NEXT_APP_ARCHS="$(/usr/bin/lipo -archs "$NEXT_EXECUTABLE_PATH"');
    expect(script).toContain('*" $EXPECTED_APP_ARCH "*) ;;');
    expect(script.indexOf('rm -rf "$BACKUP_APP_PATH"', finalSwapIndex)).toBe(-1);
  });

  it("keeps Windows signature verification values bound through environment variables", () => {
    const command = buildWindowsInstallerSignatureCommand();
    expect(command).toContain("$Path = $env:OCTO_UPDATE_INSTALLER_PATH");
    expect(command).toContain("$ExpectedPublisher = $env:OCTO_UPDATE_WINDOWS_PUBLISHER_NAME");
    expect(command).toContain("Get-AuthenticodeSignature -LiteralPath $Path");
    expect(command).not.toContain("param([string]$Path, [string]$ExpectedPublisher)");
    expect(command).not.toContain("${filePath}");
    expect(command).not.toContain("${expectedPublisher}");
  });
});
