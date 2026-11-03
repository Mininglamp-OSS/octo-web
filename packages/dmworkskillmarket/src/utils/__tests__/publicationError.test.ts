import { I18nService } from "../../../../dmworkbase/src/i18n/I18nService";
import zhCN from "../../i18n/zh-CN.json";
import { describe, expect, it } from "vitest";
import { t } from "@octo/base";
import { publicationErrorMessage } from "../publicationError";

describe("publication error messages", () => {
  it("uses localized conflict copy for both client and transport errors", () => {
    for (const error of [{ status: 409, msg: "plugin state conflicts with an existing resource" }, { response: { status: 409 } }]) {
      expect(publicationErrorMessage(error, "skillMarket.common.loadFailed")).toBe(t("skillMarket.publication.updatesConflict"));
    }
  });
  it("does not expose raw server or network diagnostics", () => {
    expect(publicationErrorMessage(new Error("SQL or transport details"), "skillMarket.form.saveFailed")).toBe(t("skillMarket.form.saveFailed"));
  });
});

it("renders the new workflow hints in Chinese through the real locale service", () => {
  const locale = new I18nService();
  locale.setLocale("zh-CN", { persist: false });
  locale.registerNamespace("skillMarket", { "zh-CN": zhCN });
  expect(locale.t("skillMarket.publication.invalidDependencies")).toBe("依赖失效");
  expect(locale.t("skillMarket.publication.updatesConflict")).toContain("资源状态已变化");
  expect(locale.t("skillMarket.publication.editResource")).toBe("进入编辑");
});
