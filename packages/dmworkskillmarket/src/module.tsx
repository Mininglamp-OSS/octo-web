import type { IModule } from "@octo/base";
import { i18n } from "@octo/base";
import enUS from "./i18n/en-US.json";
import zhCN from "./i18n/zh-CN.json";
import "./index.css";

/**
 * Skill market is surfaced under the unified "/mcp-market" shell now (see
 * dmworkmcp/MarketSidebar): a single NavRail entry, two sidebar tabs (MCP
 * 市场 / Skills 市场). This module therefore no longer registers its own
 * NavRail icon or /skill-market top-level route — dmworkmcp owns them.
 *
 * What stays here:
 *   - the "skillMarket" i18n namespace registration
 *   - the SkillListPage component (re-exported from index.tsx so dmworkmcp
 *     can mount it at /mcp-market/skills without reaching into src/pages)
 *
 * If we ever want a direct /skill-market URL back (deep-linking, SSR), just
 * re-add WKApp.route.register — the page and its i18n stay ready.
 */
export class SkillMarketModule implements IModule {
  id(): string {
    return "SkillMarketModule";
  }

  init(): void {
    i18n.registerNamespace("skillMarket", {
      "zh-CN": zhCN,
      "en-US": enUS,
    });
  }
}
