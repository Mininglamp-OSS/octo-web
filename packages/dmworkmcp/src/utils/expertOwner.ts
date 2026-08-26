import { t } from "@octo/base";
import type { ExpertItem } from "../mock/expertMock";

export interface ExpertOwner {
  botName?: string;
  humanName?: string;
}

/**
 * Resolve the bot / human names to display for an expert's creator, mirroring
 * the MCP module's resolveOwner (dmworkmcp/src/components/McpCard.tsx): a
 * bot-created entry shows the bot name + the operating human; a human-created
 * entry shows just the human. Falls back to the generic "Bot" label.
 */
export function resolveExpertOwner(item: ExpertItem): ExpertOwner {
  if (item.createdByType === "bot") {
    return {
      botName: item.botName || t("mcp.source.bot"),
      humanName: item.creatorName || undefined,
    };
  }
  return { humanName: item.creatorName };
}
