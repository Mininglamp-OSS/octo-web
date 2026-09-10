import React from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider, i18n } from "@octo/base";
import APIClient from "@octo/base/src/Service/APIClient";
import WKApp from "@octo/base/src/App";
import { FormalContentEntry } from "../../packages/dmworksummary/src/features/summaryWorkbench/FormalContentEntry";
import zhCN from "../../packages/dmworksummary/src/i18n/zh-CN.json";
import enUS from "../../packages/dmworksummary/src/i18n/en-US.json";
import "@octo/base/src/theme/index.css";
import "./style.css";

// Only synthetic fixture identity, never browser-stored credentials.
APIClient.shared.config.apiURL = "/api/v1/";
APIClient.shared.config.tokenCallback = () => "fixture-owner";
WKApp.shared.currentSpaceId = "execution-fixture";
WKApp.loginInfo.uid = "owner";
WKApp.loginInfo.token = "fixture-owner";
i18n.registerNamespace("summary", { "zh-CN": zhCN, "en-US": enUS });
i18n.setLocale(new URLSearchParams(window.location.search).get("lang") === "en-US" ? "en-US" : "zh-CN");
if (new URLSearchParams(window.location.search).get("theme") === "dark") document.body.setAttribute("theme-mode", "dark");
const root = document.getElementById("root");
if (root) createRoot(root).render(<I18nProvider>
  <FormalContentEntry taskId={110} title="Unified summary execution fixture" managed renderLegacy={() => null} />
</I18nProvider>);
