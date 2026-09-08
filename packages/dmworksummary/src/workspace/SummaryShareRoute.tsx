import React, { useEffect, useState } from "react";
import { Spin } from "@douyinfe/semi-ui";
import { getSummaryShare } from "../api/summaryApi";
import SummarySharePreviewFeature from "../features/summaryShare/SummarySharePreviewFeature";
import { getOriginalSummaryTaskId, shouldOpenOriginalSummary } from "../features/summaryShare/navigation";
import SummaryShareDetailPage from "../pages/SummaryShareDetailPage";
import type { SummaryMessagingPort } from "../host/types";
import type { SummaryWorkspaceRoute } from "./types";

export default function SummaryShareRoute({
  route,
  onRouteChange,
  messaging,
}: {
  route: Extract<SummaryWorkspaceRoute, { view: "share" }>;
  onRouteChange: (route: SummaryWorkspaceRoute) => void;
  messaging: SummaryMessagingPort;
}) {
  const [resolved, setResolved] = useState(false);
  useEffect(() => {
    let active = true;
    setResolved(false);
    if (!route.preview) {
      void getSummaryShare(route.shareId).then((share) => {
        if (!active) return;
        if (shouldOpenOriginalSummary(share)) {
          onRouteChange({
            view: "detail",
            taskId: getOriginalSummaryTaskId(share),
            originConversation: route.originConversation,
          });
        } else {
          setResolved(true);
        }
      }).catch(() => { if (active) setResolved(true); });
    }
    return () => { active = false; };
  }, [route.shareId, route.preview, route.originConversation, onRouteChange]);

  if (route.preview) {
    return <SummarySharePreviewFeature
      shareId={route.shareId}
      onClose={() => onRouteChange({ view: "list" })}
      onOpenDetail={() => onRouteChange({ ...route, preview: false })}
    />;
  }
  if (!resolved) return <div className="summary-share-detail__state"><Spin /></div>;
  return <SummaryShareDetailPage
    shareId={route.shareId}
    originChannel={route.originConversation}
    onOpenConversation={(target) => messaging.openConversation(target)}
  />;
}
