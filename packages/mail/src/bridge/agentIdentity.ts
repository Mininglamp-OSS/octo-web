import type { AgentMailbox } from "./types";

export type BotProfileLoader = (botId: string) => Promise<unknown>;

function profileName(profile: unknown): string {
  if (!profile || typeof profile !== "object" || !("name" in profile)) {
    return "";
  }
  const name = (profile as { name?: unknown }).name;
  return typeof name === "string" ? name.trim() : "";
}

export async function resolveBotDisplayName(
  botId: string,
  fallback: string,
  loadProfile: BotProfileLoader
): Promise<string> {
  const stableBotId = botId.trim();
  if (!stableBotId) return fallback;
  try {
    const profile = await loadProfile(stableBotId);
    return profileName(profile) || fallback;
  } catch {
    return fallback;
  }
}

export async function resolveAgentMailboxBotNames(
  mailboxes: AgentMailbox[],
  loadProfile: BotProfileLoader
): Promise<AgentMailbox[]> {
  return Promise.all(
    mailboxes.map(async (mailbox) => {
      if (mailbox.connectState !== "connected" || !mailbox.botId) {
        return mailbox;
      }
      const existingName = mailbox.agentName?.trim();
      const fallback =
        existingName && existingName !== mailbox.botId
          ? existingName
          : mailbox.address.split("@")[0] || mailbox.address;
      const agentName = await resolveBotDisplayName(
        mailbox.botId,
        fallback,
        loadProfile
      );
      return { ...mailbox, agentName };
    })
  );
}
