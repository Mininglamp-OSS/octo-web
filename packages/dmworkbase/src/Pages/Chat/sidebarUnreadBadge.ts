export function shouldHideRecentUnreadBadge(params: {
  recentLoading: boolean;
  followingLoading: boolean;
}) {
  return params.recentLoading || params.followingLoading;
}

export function shouldHideFollowUnreadBadge(params: {
  recentLoading: boolean;
  followingLoading: boolean;
}) {
  // 关注角标会优先复用最近会话里的实时 unread，因此最近快照未完成时也不能展示。
  return params.recentLoading || params.followingLoading;
}

export function unreadContribution(params: {
  unread: number;
  muteAuthorityReady: boolean;
  muted: boolean;
}) {
  if (params.unread <= 0 || !params.muteAuthorityReady || params.muted) {
    return 0;
  }
  return params.unread;
}
