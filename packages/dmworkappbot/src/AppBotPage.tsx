import React from "react";
import { legacyAppBotHost } from "./host/legacyAppBotHost";
import AppsWorkspace from "./workspace/AppsWorkspace";

export default function AppBotPage() {
  return <AppsWorkspace host={legacyAppBotHost} />;
}
