export function buildPrivateChatGroupMemberUids(
  loginUid: string | undefined,
  peerUid: string,
  selectedUids: string[]
) {
  const memberUids = [loginUid, peerUid, ...selectedUids].filter(
    (uid): uid is string => typeof uid === "string" && uid.length > 0
  );

  return Array.from(new Set(memberUids));
}
