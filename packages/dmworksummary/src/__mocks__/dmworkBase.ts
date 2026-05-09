export const WKApp = {
  loginInfo: { token: 'test-token-abc', uid: 'test-uid' },
  shared: { currentSpaceId: 'space-123', logout: () => {}, avatarUser: () => '' },
  routeRight: { push: () => {}, replaceToRoot: () => {} },
  mittBus: { on: () => {}, off: () => {}, emit: () => {} },
  apiClient: {},
  endpoints: { showConversation: () => {} },
};

export const isSafeUrl = (url: string) => /^https?:\/\//.test(url);
