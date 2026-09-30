import { describe, expect, it } from "vitest";
import enUS from "../i18n/en-US.json";
import zhCN from "../i18n/zh-CN.json";
import {
  resolveSkillUploadErrorKey,
  skillUploadErrorMessage,
} from "./uploadError";

interface Messages {
  [key: string]: string | Messages;
}

function translator(messages: Messages) {
  return (
    key: string,
    options?: { values?: Record<string, string | number> }
  ): string => {
    let value: string | Messages | undefined = messages;
    for (const segment of key.replace(/^skillMarket\./, "").split(".")) {
      value = typeof value === "object" ? value[segment] : undefined;
    }
    if (typeof value !== "string") return key;
    return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name: string) =>
      options?.values?.[name] === undefined
        ? match
        : String(options.values[name])
    );
  };
}

const zh = translator(zhCN);
const en = translator(enUS);

describe("skillUploadErrorMessage", () => {
  it("maps every current parse failure code to local UI copy", () => {
    const codes = [
      "DUPLICATE_NAME",
      "INVALID_ZIP",
      "FILE_TOO_LARGE",
      "SKILL_MD_TOO_LARGE",
      "SKILL_MD_NOT_FOUND",
      "ZIP_SLIP_DETECTED",
      "INVALID_SKILL_MD",
      "SKILL_NAME_MISMATCH",
      "PARSE_RETRY_EXHAUSTED",
      "PARSE_QUEUE_FULL",
      "INTERNAL_ERROR",
    ];

    for (const code of codes) {
      expect(resolveSkillUploadErrorKey({ code })).toMatch(
        /^skillMarket\.errors\./
      );
    }
  });

  it("localizes duplicate-name failures in Chinese and English", () => {
    const error = {
      code: "DUPLICATE_NAME",
      message: "A Skill with the same name already exists in this Space.",
    };

    expect(skillUploadErrorMessage(error, zh)).toBe(
      "当前空间已存在同名 Skill。请修改 SKILL.md 中的 name 后重试。"
    );
    expect(skillUploadErrorMessage(error, en)).toBe(
      "A Skill with the same name already exists in this Space. Change the name in SKILL.md and try again."
    );
  });

  it("never exposes an unknown backend message and keeps the request id", () => {
    const error = {
      code: "FUTURE_PARSE_FAILURE",
      message: "Untranslated internal backend detail",
      requestId: "req-parse-100",
    };

    expect(skillUploadErrorMessage(error, zh)).toBe(
      "解析失败，请重试（请求 ID：req-parse-100）"
    );
    expect(skillUploadErrorMessage(error, en)).toBe(
      "Parse failed. Please retry (request ID: req-parse-100)"
    );
    expect(skillUploadErrorMessage(error, zh)).not.toContain(error.message);
  });

  it("supports parse codes returned by older deployments", () => {
    expect(
      resolveSkillUploadErrorKey({ code: "err.marketplace.parse.invalid_zip" })
    ).toBe("skillMarket.errors.invalidZip");
    expect(resolveSkillUploadErrorKey({ code: "parse.no_skill_md" })).toBe(
      "skillMarket.errors.skillMdNotFound"
    );
  });
});
