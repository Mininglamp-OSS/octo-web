import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../../..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
}

describe("login page presentation", () => {
  it("starts SSO login directly without exposing migration help on the login page", () => {
    const source = readRepoFile("packages/dmworklogin/src/login.tsx");

    expect(source).toContain("onClick={startSsoLogin}");
    expect(source).not.toContain("LoginMigrationNoticeModal");
    expect(source).not.toContain("showMigrationNotice");
    expect(source).not.toContain("setMigrationNoticeVisible");
    expect(source).not.toContain("t('migration.link')");
    expect(source).not.toContain("handleSsoLoginClick");
    expect(source).not.toContain("hasAcknowledgedMigrationNotice");
    expect(source).not.toContain("acknowledgeMigrationNotice");
    expect(source).not.toContain("LOGIN_MIGRATION_NOTICE_ACK_KEY");
    expect(source).toContain("addConfigChangeListener(forceUpdate)");
  });

  it("keeps registration discoverable without competing with the primary login action", () => {
    const source = readRepoFile("packages/dmworklogin/src/login.tsx");
    const styles = readRepoFile("packages/dmworklogin/src/login.css");
    const zhCN = readRepoFile("packages/dmworklogin/src/i18n/zh-CN.json");
    const enUS = readRepoFile("packages/dmworklogin/src/i18n/en-US.json");
    expect(source).toContain('className="wk-login-content-sso-register-entry"');
    expect(source).toContain('theme="borderless"');
    expect(source).toContain('size="small"');
    expect(source).toContain(
      "onClick={() => openAegisRegister(aegisRegisterUrl)}"
    );
    expect(source).toContain("t('login.noAccountRegister')");
    expect(source).not.toContain("t('login.registerButton')");
    expect(zhCN).not.toContain('"registerButton"');
    expect(enUS).not.toContain('"registerButton"');
    expect(source).not.toContain("t('login.registerHint'");
    expect(styles).toMatch(
      /\.wk-login-content-sso-register-entry\s*\{[^}]*margin-top: var\(--wk-sp-5\);[^}]*text-align: center;[^}]*\}/s
    );
    expect(styles).not.toContain(".wk-login-content-sso-register {");
  });

  it("softens the primary login shadow without moving registration farther away", () => {
    const styles = readRepoFile("packages/dmworklogin/src/login.css");

    expect(styles).toContain(
      "--wk-sso-accent-shadow: color-mix(in srgb, var(--wk-sso-accent) 20%, transparent);"
    );
    expect(styles).toContain(
      "--wk-sso-accent-shadow-hover: color-mix(in srgb, var(--wk-sso-accent) 26%, transparent);"
    );
    expect(styles).toContain(
      "box-shadow: 0 var(--wk-sp-1) calc(var(--wk-sp-3) + var(--wk-sp-0-5)) var(--wk-sso-accent-shadow);"
    );
    expect(styles).toContain(
      "box-shadow: 0 var(--wk-sp-1-5) calc(var(--wk-sp-4) + var(--wk-sp-0-5)) var(--wk-sso-accent-shadow-hover);"
    );
    expect(styles).toMatch(
      /\.wk-login-content-sso-register-entry\s*\{[^}]*margin-top: var\(--wk-sp-5\);[^}]*\}/s
    );
  });

  it("keeps the left-side brand copy opaque without muddying the headline", () => {
    const styles = readRepoFile("packages/dmworklogin/src/login.css");

    expect(styles).toContain(
      "color-mix(in srgb, var(--wk-text-primary) 12%, transparent);"
    );
    expect(styles).toContain(
      "color: color-mix(in srgb, var(--wk-text-inverse) 96%, transparent);"
    );
  });

  it("does not describe internal Octo account provisioning on the login page", () => {
    const source = readRepoFile("packages/dmworklogin/src/login.tsx");
    const zhCN = readRepoFile("packages/dmworklogin/src/i18n/zh-CN.json");
    const enUS = readRepoFile("packages/dmworklogin/src/i18n/en-US.json");

    expect(source).not.toContain("t('login.ssoAutoCreate')");
    expect(zhCN).not.toContain('"ssoAutoCreate"');
    expect(enUS).not.toContain('"ssoAutoCreate"');
  });

  it("removes promotional trust copy and keeps only concise flow guidance", () => {
    const source = readRepoFile("packages/dmworklogin/src/login.tsx");
    const styles = readRepoFile("packages/dmworklogin/src/login.css");
    const zhCN = readRepoFile("packages/dmworklogin/src/i18n/zh-CN.json");
    const enUS = readRepoFile("packages/dmworklogin/src/i18n/en-US.json");

    expect(source).toContain('className="wk-login-content-sso-flow-hint"');
    expect(source).toContain("t('login.ssoFlowHint')");
    expect(zhCN).toContain('"ssoFlowHint": "登录和注册将在统一认证页面完成"');
    expect(enUS).toContain(
      '"ssoFlowHint": "Login and registration continue on the unified authentication page."'
    );
    expect(source).not.toContain("wk-login-content-sso-meta");
    expect(source).not.toContain("t('login.ssoMeta");
    expect(zhCN).not.toContain('"ssoMeta');
    expect(enUS).not.toContain('"ssoMeta');
    expect(styles).not.toContain(".wk-login-content-sso-meta");
    expect(styles).toMatch(
      /\.wk-login-content-sso-flow-hint\s*\{[^}]*color: var\(--semi-color-text-2[^}]*font-size: var\(--wk-text-size-sm\);[^}]*\}/s
    );

    const flowHintIndex = source.indexOf("wk-login-content-sso-flow-hint");
    const downloadIndex = source.indexOf(
      "wk-login-content-download-divider",
      flowHintIndex
    );
    expect(flowHintIndex).toBeGreaterThan(-1);
    expect(downloadIndex).toBeGreaterThan(flowHintIndex);
    expect(source).not.toContain("wk-login-content-sso-help");
    expect(source).not.toContain("t('migration.");
  });

  it("uses the standard Semi Select for the login-page language selector", () => {
    const source = readRepoFile("packages/dmworklogin/src/login.tsx");
    const zhCN = readRepoFile("packages/dmworklogin/src/i18n/zh-CN.json");
    const enUS = readRepoFile("packages/dmworklogin/src/i18n/en-US.json");

    expect(source).toContain("Button, Select, Spin, Toast");
    expect(source).toContain('className="wk-login-language-select"');
    expect(source).toContain("optionList={locales}");
    expect(source).not.toContain("renderSelectedItem=");
    expect(source).toContain('t("login.languageShortZh")');
    expect(source).toContain('t("login.languageShortEn")');
    expect(source).not.toContain("IconGlobeStroke");
    expect(source).not.toContain("wk-login-language-mask");
    expect(source).not.toContain("wk-login-language-menu-item");
    expect(zhCN).toContain('"languageShortEn": "EN"');
    expect(zhCN).toContain('"languageShortZh": "中文"');
    expect(enUS).toContain('"languageShortEn": "EN"');
    expect(enUS).toContain('"languageShortZh": "中文"');
  });

  it("keeps the language label and arrow visible without hover", () => {
    const source = readRepoFile("packages/dmworklogin/src/login.tsx");
    const styles = readRepoFile("packages/dmworklogin/src/login.css");

    expect(source).not.toContain("                borderless\n");
    expect(styles).toContain("width: calc(var(--wk-sp-12) + var(--wk-sp-8));");
    expect(styles).toMatch(
      /\.wk-login-language-select\s*\{[^}]*background: transparent;[^}]*text-align: center;[^}]*\}/s
    );
  });

  it("uses the same short labels inside and outside the language menu", () => {
    const source = readRepoFile("packages/dmworklogin/src/login.tsx");

    expect(source).toContain(
      '{ value: "zh-CN", label: t("login.languageShortZh"), showTick: false }'
    );
    expect(source).toContain(
      '{ value: "en-US", label: t("login.languageShortEn"), showTick: false }'
    );
    expect(source).not.toContain("base.navRail.language.name.zh");
    expect(source).not.toContain("base.navRail.language.name.en");
  });

  it("releases pointer focus after switching languages but keeps keyboard focus", () => {
    const source = readRepoFile("packages/dmworklogin/src/login.tsx");

    expect(source).toContain("pointerLanguageSelectionRef");
    expect(source).toContain("onPointerDownCapture");
    expect(source).toContain("onKeyDownCapture");
    expect(source).toContain("if (!pointerLanguageSelectionRef.current) return");
    expect(source).toContain("activeElement.blur()");
    expect(source).not.toContain("document.activeElement.blur()");
  });

  it("credits Mininglamp beneath the copyright with a safe external link", () => {
    const source = readRepoFile("packages/dmworklogin/src/login.tsx");
    const styles = readRepoFile("packages/dmworklogin/src/login.css");
    const zhCN = readRepoFile("packages/dmworklogin/src/i18n/zh-CN.json");
    const enUS = readRepoFile("packages/dmworklogin/src/i18n/en-US.json");

    expect(source).toContain("t('login.designedBy')");
    expect(source).toContain('href="https://www.mininglamp.com/"');
    expect(source).toContain('target="_blank"');
    expect(source).toContain('rel="noopener noreferrer"');
    expect(source).toContain(">Mininglamp</a>");
    expect(styles).toMatch(
      /\.wk-login-panel-footer\s*\{[^}]*flex-direction: column;[^}]*\}/s
    );
    expect(zhCN).toContain('"designedBy": "Designed by"');
    expect(enUS).toContain('"designedBy": "Designed by"');
  });

  it("delegates the Android download entry to the QR popover component", () => {
    const source = readRepoFile("packages/dmworklogin/src/login.tsx");

    expect(source).toContain(
      'import { AndroidDownloadButton } from "./AndroidDownloadButton";'
    );
    expect(source).not.toContain("const AndroidDownloadButton: React.FC");
    expect(source).not.toContain("common/updater/android/1.0");
    expect(source).not.toContain("/download/dmwork.apk");
    expect(source).not.toContain("apiFetchJson");
  });

  it("keeps an unlabelled divider above equal centered download buttons", () => {
    const source = readRepoFile("packages/dmworklogin/src/login.tsx");
    const styles = readRepoFile("packages/dmworklogin/src/login.css");
    const dividerRule = styles.match(
      /\.wk-login-content-download-divider \{([\s\S]*?)\}/
    )?.[1];
    const buttonRule = styles.match(
      /\.wk-login-download-btn \{([\s\S]*?)\}/
    )?.[1];

    expect(source).not.toContain("t('download.mobile')");
    expect(dividerRule).not.toContain("gap:");
    expect(buttonRule).toContain("width: 184px;");
    expect(buttonRule).toContain("height: var(--wk-sp-10);");
    expect(buttonRule).toContain("align-items: center;");
    expect(buttonRule).toContain("justify-content: center;");
    expect(buttonRule).not.toContain("!important");
    expect(buttonRule).not.toContain("#1C1C23");
  });
});
