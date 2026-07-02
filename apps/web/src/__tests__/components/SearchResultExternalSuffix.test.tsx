/**
 * 搜索结果外部成员/消息 @SpaceName 后缀判定单测。
 *
 * 覆盖 tab-contacts / tab-all / AssigneeEditor 三处搜索入口使用的 resolver
 * 输入构造路径：
 *   1. 新字段 home_space_id / home_space_name 优先
 *   2. 老字段 is_external + source_space_name 降级兼容
 *   3. 同 Space / 自己 / 信息缺失 → 不渲染后缀（返回空字符串）
 *
 * resolver 纯函数本身见 packages/dmworkbase/src/Utils/__tests__/externalViewer.test.ts；
 * 本文件只校验三处适配层 → resolver 入参的边界契约。
 */

import { vi } from 'vitest';

// 直接引用 resolver 源文件，避免 barrel 把浏览器依赖拉进 jsdom。
import { resolveExternalForViewer } from '../../../../../packages/dmworkbase/src/Utils/externalViewer';

// hoisted mock：避开 packages/dmworkbase/App 入口的浏览器副作用（lottie/Howler）。
vi.mock('../../../../../packages/dmworkbase/src/App', () => ({
  default: {
    shared: {
      currentSpaceId: '',
    },
  },
}));

// tab-contacts 适配镜像：friend 顶层 / orgData → resolver 入参。
function computeContactSuffix(friend: any): string {
  const org = friend?.orgData ?? {};
  const { isExternal, sourceSpaceName } = resolveExternalForViewer({
    homeSpaceId: friend?.home_space_id ?? org.home_space_id,
    homeSpaceName: friend?.home_space_name ?? org.home_space_name,
    isExternalLegacy: friend?.is_external ?? org.is_external,
    sourceSpaceNameLegacy: friend?.source_space_name ?? org.source_space_name,
    viewerSpaceId: friend?.__viewerSpaceId, // 仅测试用
  });
  return isExternal ? sourceSpaceName : '';
}

// tab-all 适配镜像：message 的 from_* 字段 → resolver 入参。
function computeMessageSenderSuffix(msg: any): string {
  const isExternalLegacy =
    typeof msg.from_is_external === 'boolean'
      ? (msg.from_is_external ? 1 : 0)
      : msg.from_is_external;
  const { isExternal, sourceSpaceName } = resolveExternalForViewer({
    homeSpaceId: msg.from_home_space_id,
    homeSpaceName: msg.from_home_space_name,
    isExternalLegacy,
    sourceSpaceNameLegacy: msg.from_source_space_name,
    viewerSpaceId: msg.__viewerSpaceId,
  });
  return isExternal ? sourceSpaceName : '';
}

// AssigneeEditor 适配镜像：Contacts 无字段，从 channelInfo.orgData 读取。
function computeAssigneeSuffix(org: any, viewerSpaceId: string): string {
  if (!org) return '';
  const { isExternal, sourceSpaceName } = resolveExternalForViewer({
    homeSpaceId: org.home_space_id,
    homeSpaceName: org.home_space_name,
    isExternalLegacy: org.is_external,
    sourceSpaceNameLegacy: org.source_space_name,
    viewerSpaceId,
  });
  return isExternal ? sourceSpaceName : '';
}

describe('搜索结果外部后缀', () => {
  describe('联系人搜索（tab-contacts）', () => {
    it('跨 Space friend（新字段）→ 显示 @SpaceName', () => {
      expect(
        computeContactSuffix({
          channel_id: 'u1',
          channel_name: 'Alice',
          __viewerSpaceId: 'space-A',
          home_space_id: 'space-B',
          home_space_name: 'ExampleCorp',
        })
      ).toBe('ExampleCorp');
    });

    it('同 Space friend（新字段）→ 不显示', () => {
      expect(
        computeContactSuffix({
          channel_id: 'u1',
          channel_name: 'Alice',
          __viewerSpaceId: 'space-A',
          home_space_id: 'space-A',
          home_space_name: 'SpaceA',
        })
      ).toBe('');
    });

    it('字段在 orgData 而非顶层（兜底读取）→ 显示', () => {
      expect(
        computeContactSuffix({
          channel_id: 'u1',
          channel_name: 'Bob',
          __viewerSpaceId: 'space-A',
          orgData: { home_space_id: 'space-C', home_space_name: 'PartnerCo' },
        })
      ).toBe('PartnerCo');
    });

    it('降级兼容：只有 is_external=1 + source_space_name → 显示', () => {
      expect(
        computeContactSuffix({
          channel_id: 'u1',
          channel_name: 'Carol',
          __viewerSpaceId: 'space-A',
          is_external: 1,
          source_space_name: 'Legacy',
        })
      ).toBe('Legacy');
    });

    it('降级兼容：is_external=0 → 不显示', () => {
      expect(
        computeContactSuffix({
          channel_id: 'u1',
          channel_name: 'Dan',
          __viewerSpaceId: 'space-A',
          is_external: 0,
        })
      ).toBe('');
    });

    it('home_space_id 存在但 home_space_name 缺失 → isExternal 但后缀为空', () => {
      expect(
        computeContactSuffix({
          channel_id: 'u1',
          channel_name: 'Eve',
          __viewerSpaceId: 'space-A',
          home_space_id: 'space-B',
        })
      ).toBe('');
    });
  });

  describe('消息搜索（tab-all，from_* msg-level）', () => {
    it('跨 Space 外部消息（新 msg-level）→ 显示 @SpaceName', () => {
      expect(
        computeMessageSenderSuffix({
          __viewerSpaceId: 'space-A',
          from_home_space_id: 'space-B',
          from_home_space_name: 'ExampleCorp',
        })
      ).toBe('ExampleCorp');
    });

    it('同 Space 内部消息 → 不显示', () => {
      expect(
        computeMessageSenderSuffix({
          __viewerSpaceId: 'space-A',
          from_home_space_id: 'space-A',
          from_home_space_name: 'SpaceA',
        })
      ).toBe('');
    });

    it('降级兼容：旧 msg-level from_is_external=1 + from_source_space_name → 显示', () => {
      expect(
        computeMessageSenderSuffix({
          __viewerSpaceId: 'space-A',
          from_is_external: 1,
          from_source_space_name: 'Legacy',
        })
      ).toBe('Legacy');
    });

    it('boolean from_is_external=true 兼容 → 显示', () => {
      expect(
        computeMessageSenderSuffix({
          __viewerSpaceId: 'space-A',
          from_is_external: true,
          from_source_space_name: 'BoolLegacy',
        })
      ).toBe('BoolLegacy');
    });

    it('无任何来源字段（内部老消息）→ 不显示', () => {
      expect(
        computeMessageSenderSuffix({
          __viewerSpaceId: 'space-A',
        })
      ).toBe('');
    });
  });

  describe('Todo 分派候选（AssigneeEditor）', () => {
    it('候选归属跨 Space（orgData 新字段）→ 显示', () => {
      expect(
        computeAssigneeSuffix(
          { home_space_id: 'space-B', home_space_name: 'PartnerCo' },
          'space-A'
        )
      ).toBe('PartnerCo');
    });

    it('候选同 Space → 不显示', () => {
      expect(
        computeAssigneeSuffix(
          { home_space_id: 'space-A', home_space_name: 'SpaceA' },
          'space-A'
        )
      ).toBe('');
    });

    it('候选无 orgData（channelInfo 未预取）→ 不显示，等下次重渲染', () => {
      expect(computeAssigneeSuffix(undefined, 'space-A')).toBe('');
    });

    it('降级兼容：is_external=1 + source_space_name → 显示', () => {
      expect(
        computeAssigneeSuffix(
          { is_external: 1, source_space_name: 'Legacy' },
          'space-A'
        )
      ).toBe('Legacy');
    });
  });
});
