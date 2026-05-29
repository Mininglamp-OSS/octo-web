// Mock for @octo/base — provides WKApp stubs for tests
//
// dataSource.commonDataSource.getFileURL 默认是恒等函数 (返回原始 URL),
// 单测里可以 import 这个 mock 再覆盖该函数, 模拟不同的 baseURL/OSS 行为。
export const WKApp = {
  loginInfo: { token: 'test-token-abc', uid: 'test-uid' },
  shared: { currentSpaceId: 'space-123', logout: () => { }, avatarUser: () => '' },
  routeRight: { push: () => { }, replaceToRoot: () => { } },
  mittBus: { on: () => { }, off: () => { }, emit: () => { } },
  apiClient: {},
  endpoints: { showConversation: () => {} },
  dataSource: {
    commonDataSource: {
      getFileURL: (raw: string) => raw,
    },
  },
};

export const buildAcceptLanguage = () => 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7';

export const isSafeUrl = (url: string) => /^https?:\/\//.test(url);

// Thread enum / type re-exports — production code imports these from
// '@octo/base' (re-exported via dmworkbase/src/index.tsx). The vitest
// alias points '@octo/base' at this mock file, so we re-export the
// minimal surface the dmworktodo code touches.
export enum ThreadStatus {
  Active = 1,
  Archived = 2,
  Deleted = 3,
}

// Thread is type-only at runtime; export an empty interface to satisfy
// `import type { Thread } from '@octo/base'`.
export interface Thread {
  short_id: string;
  group_no: string;
  channel_id: string;
  channel_type: number;
  name: string;
  creator_uid: string;
  status: number;
  created_at: string;
  updated_at: string;
  is_member?: boolean;
  member_count?: number;
}
