export function shouldHideRecentUnreadBadge(params: {
  recentLoading: boolean;
  followingLoading: boolean;
  missingMuteAuthority: boolean;
}) {
  return (
    params.recentLoading ||
    params.followingLoading ||
    params.missingMuteAuthority
  );
}

export function shouldHideFollowUnreadBadge(params: {
  recentLoading: boolean;
  followingLoading: boolean;
  missingMuteAuthority: boolean;
}) {
  // 关注角标会优先复用最近会话里的实时 unread，因此最近快照未完成时也不能展示。
  return (
    params.recentLoading ||
    params.followingLoading ||
    params.missingMuteAuthority
  );
}
