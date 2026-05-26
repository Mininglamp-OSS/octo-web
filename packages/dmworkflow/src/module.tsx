import React from "react";
import type { IModule } from "@octo/base/src/Service/Module";
import { WKApp, Menus } from "@octo/base";
import FlowListPage from "./pages/FlowListPage";
import FlowEditorPage from "./pages/FlowEditorPage";
import FlowExecutionsPage from "./pages/FlowExecutionsPage";

/**
 * octo-web is a three-pane shell: NavRail | left panel (~300 px) | right panel
 * (the wide main area). Anything registered through `WKApp.route.register(...)`
 * is rendered by `MainContentLeft` inside the narrow left panel — that fits
 * list views (chats, contacts, summary list) but does NOT fit the Flow editor
 * canvas.
 *
 * Following the SummaryModule pattern, we only register the list page on the
 * left, and push the editor / execution-history pages to the right pane via
 * `WKApp.routeRight.*`. This keeps the React Flow canvas full-width.
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

// ─── Right-pane navigation helpers ────────────────────────────────────────
// Centralised so list / editor / executions pages all push to the same stack
// with identical onBack semantics. Exposed on WKApp so external entries (e.g.
// notifications, deeplinks) can drop straight into the editor.

function openFlowEditor(flowId: string): void {
  WKApp.switchToMenuById?.("flow");
  WKApp.routeRight.replaceToRoot(
    <FlowEditorPage
      flowId={flowId}
      onBack={() => WKApp.routeRight.popToRoot()}
      onOpenExecutions={(id, executionId) => openFlowExecutions(id, executionId)}
    />,
  );
}

function openFlowExecutions(flowId: string, executionId?: string | null): void {
  WKApp.switchToMenuById?.("flow");
  WKApp.routeRight.push(
    <FlowExecutionsPage
      flowId={flowId}
      executionId={executionId ?? null}
      onBack={() => WKApp.routeRight.pop()}
      onClose={() => WKApp.routeRight.popToRoot()}
    />,
  );
}

// Re-export so other modules can import without reaching into module internals.
(WKApp as any).openFlowEditor = openFlowEditor;
(WKApp as any).openFlowExecutions = openFlowExecutions;

export class FlowModule implements IModule {
  id(): string {
    return "FlowModule";
  }

  init(): void {
    // Only the list lives on the left. The editor / executions pages are
    // pushed to the right pane via the helpers above so they get the full
    // canvas width that React Flow needs.
    WKApp.route.register("/flow", () => (
      <FlowListPage
        onOpenEditor={openFlowEditor}
        onOpenExecutions={(id) => openFlowExecutions(id)}
      />
    ));

    // Top-level nav entry, weight chosen to sit after summary (5000).
    // No onPress override — the default in MainPage.onMenuClick already does
    // `routeLeft.popToRoot() + routeRight.popToRoot()`, which is exactly what
    // we want: show the list on the left and clear any stale editor on the
    // right.
    WKApp.menus.register(
      "flow",
      (_ctx) => new Menus("flow", "/flow", "Flow", <FlowIcon />, <FlowIcon />),
      6000,
    );
  }
}
