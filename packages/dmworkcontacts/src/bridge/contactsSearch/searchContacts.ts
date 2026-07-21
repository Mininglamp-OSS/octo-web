import type {
  ContactsSearchBot,
  ContactsSearchResult,
  ContactsSearchSource,
} from "./types";

function normalizeName(value?: string): string {
  return (value || "").replace(/\*\*/g, "").toLowerCase();
}

export function searchContacts(
  keyword: string,
  source: ContactsSearchSource
): ContactsSearchResult {
  const normalizedKeyword = keyword.toLowerCase();
  const memberUids = new Set(source.spaceMembers.map((member) => member.uid));
  const memberResults = source.spaceMembers
    .filter((member) => member.uid !== source.currentUid)
    .filter((member) => normalizeName(member.name).includes(normalizedKeyword));
  const extraBotResults = source.spaceBots
    .filter((bot) => bot.uid !== source.currentUid && !memberUids.has(bot.uid))
    .filter((bot) => normalizeName(bot.name).includes(normalizedKeyword))
    .map((bot) => {
      const item: ContactsSearchBot = { ...bot, robot: 1 };
      return item;
    });
  const groups = source.myGroups.filter(
    (group) =>
      group.name && normalizeName(group.name).includes(normalizedKeyword)
  );

  return { contacts: [...memberResults, ...extraBotResults], groups };
}
