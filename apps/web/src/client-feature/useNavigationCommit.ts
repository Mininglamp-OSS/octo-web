import { useLayoutEffect, useMemo } from "react";
import { hasNavigationCommitBridge, NavigationCommitController } from "./navigationCommit";

export function useNavigationCommit(bridge: {
  reportNavigationCommitted?: (params: { navigationId: number }) => Promise<void>;
}) {
  const controller = useMemo(() => hasNavigationCommitBridge(bridge)
    ? new NavigationCommitController(
      (navigationId) => bridge.reportNavigationCommitted!({ navigationId }),
    )
    : undefined, [bridge]);

  useLayoutEffect(() => () => controller?.dispose(), [controller]);
  return controller;
}
