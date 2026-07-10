export const AGENT_PROGRESS_LAYOUT = "agent_progress_v1";

export function isAgentProgressCard(card: Record<string, unknown>): boolean {
  const metadata = card.metadata;
  return (
    !!metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).octo_layout === AGENT_PROGRESS_LAYOUT
  );
}
