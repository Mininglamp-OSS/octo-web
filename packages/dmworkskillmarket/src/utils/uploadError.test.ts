import { describe, expect, it } from "vitest";
import { I18nService } from "../../../dmworkbase/src/i18n/I18nService";
import enUS from "../i18n/en-US.json";
import zhCN from "../i18n/zh-CN.json";
import {
  resolveSkillUploadErrorKey,
  skillUploadErrorMessage,
} from "./uploadError";

function translator(locale: "zh-CN" | "en-US") {
  const service = new I18nService();
  service.registerNamespace("skillMarket", {
    "zh-CN": zhCN,
    "en-US": enUS,
  });
  service.setLocale(locale, { notify: false, persist: false });
  return service.t.bind(service);
}

const zh = translator("zh-CN");
const en = translator("en-US");

describe("skillUploadErrorMessage", () => {
  it("maps every current backend parse failure code to the expected local key", () => {
    const cases = {
      DUPLICATE_NAME: "skillMarket.errors.duplicateName",
      INVALID_ZIP: "skillMarket.errors.invalidZip",
      FILE_TOO_LARGE: "skillMarket.errors.fileTooLarge",
      SKILL_MD_TOO_LARGE: "skillMarket.errors.skillMdTooLarge",
      SKILL_MD_NOT_FOUND: "skillMarket.errors.skillMdNotFound",
      MULTIPLE_SKILL_MD: "skillMarket.errors.multipleSkillMd",
      TOO_MANY_FILES: "skillMarket.errors.tooManyFiles",
      DUPLICATE_ENTRY: "skillMarket.errors.duplicateArchiveEntry",
      ZIP_SLIP_DETECTED: "skillMarket.errors.unsafeArchivePath",
      INVALID_SKILL_MD: "skillMarket.errors.invalidSkillMd",
      SKILL_NAME_MISMATCH: "skillMarket.errors.skillNameMismatch",
      PARSE_RETRY_EXHAUSTED: "skillMarket.errors.parseRetryExhausted",
      PARSE_QUEUE_FULL: "skillMarket.errors.parseQueueFull",
      INTERNAL_ERROR: "skillMarket.errors.parseServiceUnavailable",
    } as const;

    for (const [code, key] of Object.entries(cases)) {
      expect(resolveSkillUploadErrorKey({ code })).toBe(key);
      expect(skillUploadErrorMessage({ code }, {}, zh)).not.toBe(key);
      expect(skillUploadErrorMessage({ code }, {}, en)).not.toBe(key);
    }
  });

  it("localizes duplicate-name failures in Chinese and English", () => {
    const error = {
      code: "DUPLICATE_NAME",
      message: "A Skill with the same name already exists in this Space.",
    };

    expect(skillUploadErrorMessage(error, {}, zh)).toBe(
      "当前空间已存在同名 Skill。请修改 SKILL.md 中的 name 后重试。"
    );
    expect(skillUploadErrorMessage(error, {}, en)).toBe(
      "A Skill with the same name already exists in this Space. Change the name in SKILL.md and try again."
    );
  });

  it("never exposes an unknown backend message and keeps the request id", () => {
    const error = {
      code: "FUTURE_PARSE_FAILURE",
      message: "Untranslated internal backend detail",
      requestId: "req-parse-100",
    };

    expect(skillUploadErrorMessage(error, {}, zh)).toBe(
      "解析失败，请重试（请求 ID：req-parse-100）"
    );
    expect(skillUploadErrorMessage(error, {}, en)).toBe(
      "Parse failed. Please retry (request ID: req-parse-100)"
    );
    expect(skillUploadErrorMessage(error, {}, zh)).not.toContain(error.message);
  });

  it("supports parse codes returned by older deployments", () => {
    expect(
      resolveSkillUploadErrorKey({ code: "err.marketplace.parse.invalid_zip" })
    ).toBe("skillMarket.errors.invalidZip");
    expect(resolveSkillUploadErrorKey({ code: "parse.no_skill_md" })).toBe(
      "skillMarket.errors.skillMdNotFound"
    );
  });

  it("uses the caller's phase fallback and keeps the request id", () => {
    expect(
      skillUploadErrorMessage(
        { message: "Upload failed: HTTP 503", requestId: "req-upload-1" },
        { fallbackKey: "skillMarket.upload.uploadFailed" },
        zh
      )
    ).toBe("上传失败（请求 ID：req-upload-1）");
  });

  it("keeps INTERNAL_ERROR parse-specific only during parsing", () => {
    expect(
      skillUploadErrorMessage(
        { code: "INTERNAL_ERROR", requestId: "req-save-500" },
        { fallbackKey: "skillMarket.form.saveFailed" },
        zh
      )
    ).toBe("保存失败（请求 ID：req-save-500）");
    expect(
      skillUploadErrorMessage(
        { code: "INTERNAL_ERROR", requestId: "req-parse-500" },
        { fallbackKey: "skillMarket.errors.parseFailed" },
        zh
      )
    ).toBe("解析服务暂时不可用，请稍后重试（请求 ID：req-parse-500）");
  });

  it("keeps request ids on mapped errors", () => {
    expect(
      skillUploadErrorMessage(
        { code: "parse_timeout", requestId: "req-timeout-59" },
        {},
        zh
      )
    ).toBe("解析超时，请重试（请求 ID：req-timeout-59）");
  });

  it("does not resolve inherited object property names", () => {
    for (const code of [
      "toString",
      "constructor",
      "valueOf",
      "hasOwnProperty",
      "__proto__",
    ]) {
      expect(resolveSkillUploadErrorKey({ code })).toBeUndefined();
      expect(typeof skillUploadErrorMessage({ code }, {}, zh)).toBe("string");
    }
  });
});
