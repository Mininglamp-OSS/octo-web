import { getPinyin } from "../../Utils/pinYin";
import { toSimplized } from "../../Utils/t2s";
import type { SpaceMemberOption } from "../../bridge/spaceMembers/types";

function memberSearchText(member: SpaceMemberOption): string {
  const simplifiedName = toSimplized(member.name).toLowerCase();
  return [
    member.uid.toLowerCase(),
    member.name.toLowerCase(),
    simplifiedName,
    getPinyin(simplifiedName).toLowerCase(),
  ].join("\n");
}

export function filterSpaceMemberOptions(
  members: SpaceMemberOption[],
  keyword: string
): SpaceMemberOption[] {
  const normalizedKeyword = toSimplized(keyword).trim().toLowerCase();
  if (!normalizedKeyword) return members;
  return members.filter((member) =>
    memberSearchText(member).includes(normalizedKeyword)
  );
}
