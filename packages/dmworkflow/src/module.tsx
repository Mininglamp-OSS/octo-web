import React from "react";
import type { IModule } from "@octo/base/src/Service/Module";
import { WKApp, Menus } from "@octo/base";
import FlowListPage from "./pages/FlowListPage";
import FlowEditorPage from "./pages/FlowEditorPage";
import FlowExecutionsPage from "./pages/FlowExecutionsPage";

/**
 * The WKApp router is a flat path → component map (see Service/Route.tsx).
 * It does not natively support `/flow/:id` style segment matching, so we
 * follow the existing module convention (e.g. SummaryModule registering
 * `/summary/detail` with a `taskId` param) and expose:
 *
 *   /flow            — list page
 *   /flow/edit       — editor (param: { flowId })
 *   /flow/executions — execution history (param: { flowId })
 *   /flow/execution  — single-execution detail (param: { flowId, executionId })
 *
 * Cross-page navigation goes through WKApp.route.push(path, param). The
 * `:id` semantics from the issue spec are preserved as param keys.
 */
function FlowIcon({ active }: { active?: boolean }) {
  const color = active ? "var(--wk-brand-primary, #7C5CFC)" : "currentColor";
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="6" r="2" />
      <circle cx="19" cy="6" r="2" />
      <circle cx="12" cy="18" r="2" />
      <path d="M7 6h10M6 8l5 8M18 8l-5 8" />
    </svg>
  );
}

export class FlowModule implements IModule {
  id(): string {
    return "FlowModule";
  }

  init(): void {
    WKApp.route.register("/flow", () => <FlowListPage />);

    WKApp.route.register("/flow/edit", (param: { flowId?: string } | undefined) => {
      const flowId = param?.flowId ?? "";
      return <FlowEditorPage flowId={flowId} />;
    });

    WKApp.route.register("/flow/executions", (param: { flowId?: string; executionId?: string } | undefined) => {
      return (
        <FlowExecutionsPage
          flowId={param?.flowId ?? ""}
          executionId={param?.executionId ?? null}
        />
      );
    });

    WKApp.route.register("/flow/execution", (param: { flowId?: string; executionId?: string } | undefined) => {
      return (
        <FlowExecutionsPage
          flowId={param?.flowId ?? ""}
          executionId={param?.executionId ?? null}
        />
      );
    });

    // Top-level nav entry, weight chosen to sit after summary (5000).
    WKApp.menus.register("flow", (_ctx) => {
      const m = new Menus("flow", "/flow", "Flow", <FlowIcon />, <FlowIcon />);
      m.onPress = () => {
        WKApp.routeLeft.popToRoot();
        const page = WKApp.route.get("/flow");
        if (page && React.isValidElement(page)) {
          WKApp.routeRight.replaceToRoot(page);
        }
      };
      return m;
    }, 6000);
  }
}
