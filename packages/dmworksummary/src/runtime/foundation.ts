import { i18n, WKApp } from "@octo/base";
import { getChatCandidates } from "../api/summaryApi";
import enUS from "../i18n/en-US.json";
import zhCN from "../i18n/zh-CN.json";

export function registerSummaryFoundation(): void {
  i18n.registerNamespace("summary", {
    "zh-CN": zhCN,
    "en-US": enUS,
  });
}

export function registerSummaryCandidateSearch(): void {
  WKApp.searchChatCandidates = async (params) => getChatCandidates(params);
}
