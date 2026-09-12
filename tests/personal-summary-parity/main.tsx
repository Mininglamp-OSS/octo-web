import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider, i18n } from "@octo/base";
import WKApp from "@octo/base/src/App";
import APIClient from "@octo/base/src/Service/APIClient";
import SummaryWorkspace from "../../packages/dmworksummary/src/workspace/SummaryWorkspace";
import type { SummaryWorkspaceRoute } from "../../packages/dmworksummary/src/workspace/types";
import { registerSummaryFoundation, registerSummaryCandidateSearch } from "../../packages/dmworksummary/src/runtime/foundation";
import "@octo/base/src/theme/index.css";
import "../../packages/dmworksummary/src/index.css";
import "./style.css";

// Synthetic identity and data only. This host never talks to real Octo data.
APIClient.shared.config.apiURL = "/api/v1/";
APIClient.shared.config.tokenCallback = () => "parity-fixture";
WKApp.shared.currentSpaceId = "parity-fixture";
WKApp.loginInfo.uid = "owner";
WKApp.loginInfo.token = "parity-fixture";
registerSummaryFoundation();
registerSummaryCandidateSearch();
const params = new URLSearchParams(location.search);
i18n.setLocale(params.get("lang") === "en-US" ? "en-US" : "zh-CN");
if (params.get("theme") === "dark") document.body.setAttribute("theme-mode", "dark");

function Fixture() {
    const [route, setRoute] = useState<SummaryWorkspaceRoute>({ view: "detail", taskId: Number(params.get("task") || 1) });
    return <SummaryWorkspace route={route} onRouteChange={setRoute} />;
}
createRoot(document.getElementById("root")!).render(<I18nProvider><Fixture /></I18nProvider>);
