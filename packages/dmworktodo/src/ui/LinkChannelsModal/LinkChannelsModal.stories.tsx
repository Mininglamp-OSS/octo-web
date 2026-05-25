import React from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import LinkChannelsModal from './index'
import type { MatterChannel } from '../../bridge/types'
import type { ChannelOption, LoadChannelsResult } from './index'

const sampleChannels: ChannelOption[] = [
  { channelId: 'ch-001', channelType: 2, name: '产品负责人群', desc: '产品方向讨论', memberCount: 12 },
  { channelId: 'ch-001____t-001', channelType: 5, name: '需求评审', memberCount: 8, parentGroupName: '产品负责人群', parentGroupNo: 'ch-001' },
  { channelId: 'ch-001____t-002', channelType: 5, name: '设计稿走查', memberCount: 5, parentGroupName: '产品负责人群', parentGroupNo: 'ch-001' },
  { channelId: 'ch-002', channelType: 2, name: '技术架构群', desc: '技术方案评审', memberCount: 8 },
  { channelId: 'ch-002____t-101', channelType: 5, name: 'API 设计讨论', memberCount: 6, parentGroupName: '技术架构群', parentGroupNo: 'ch-002' },
  { channelId: 'ch-003', channelType: 2, name: '设计评审群', memberCount: 5 },
]

const mockLoadChannels = async (): Promise<LoadChannelsResult> => ({
  channels: sampleChannels,
})

// 群+子区数量超过 200 项的极端场景, 验证截断提示
const mockLoadChannelsLarge = async (): Promise<LoadChannelsResult> => {
  const out: ChannelOption[] = []
  for (let i = 0; i < 30; i++) {
    out.push({
      channelId: `g-${i}`,
      channelType: 2,
      name: `群-${i}`,
      desc: `示例群 ${i}`,
      memberCount: 10 + i,
    })
    for (let j = 0; j < 10; j++) {
      out.push({
        channelId: `g-${i}____t-${j}`,
        channelType: 5,
        name: `子区-${i}-${j}`,
        memberCount: 3 + j,
        parentGroupName: `群-${i}`,
        parentGroupNo: `g-${i}`,
      })
    }
  }
  return { channels: out }
}

// 部分群子区拉取失败的场景: surface 警告条 + 重试按钮
const mockLoadChannelsPartialFailure = async (): Promise<LoadChannelsResult> => ({
  channels: sampleChannels,
  threadLoadErrors: ['运营周报群', '客户对接群'],
})

// 多群失败 (超过 ERROR_NAME_PREVIEW_LIMIT=3, 折叠成 "等 N 个" 文案)
const mockLoadChannelsManyFailures = async (): Promise<LoadChannelsResult> => ({
  channels: sampleChannels,
  threadLoadErrors: ['运营周报群', '客户对接群', '渠道伙伴群', '法务对接群', 'HR 答疑群'],
})

const mockOnLinkChannel = async (_matterId: string, _channelId: string, _channelType: number, _channelName: string) => {
  // no-op for stories
}

const meta: Meta<typeof LinkChannelsModal> = {
  title: 'Matter/LinkChannelsModal',
  component: LinkChannelsModal,
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof LinkChannelsModal>

const mockLinkedChannels: MatterChannel[] = [
  {
    id: 'ch1',
    matter_id: 'm1',
    channel_id: '111bcaea9ad145ca9b8fafdad50b2196',
    channel_type: 2,
    linked_by: '43e10cf1cd1e490584110a906ede665f',
    created_at: '2026-05-10T11:39:13.773Z',
  },
]

/**
 * 默认态 — 打开关联群聊弹窗
 */
export const Default: Story = {
  args: {
    visible: true,
    matterId: '8575cfce-e60a-4ee6-a3c5-7121cd46490d',
    matterTitle: 'Octo 产品策略 PPT 打磨',
    linkedChannels: [],
    onClose: () => {},
    onLinked: () => {},
    loadChannels: mockLoadChannels,
    onLinkChannel: mockOnLinkChannel,
  },
}

/**
 * 已有关联群 — 部分群标记为"已关联"不可重复选
 */
export const WithLinkedChannels: Story = {
  args: {
    visible: true,
    matterId: '8575cfce-e60a-4ee6-a3c5-7121cd46490d',
    matterTitle: 'Octo 产品策略 PPT 打磨',
    linkedChannels: mockLinkedChannels,
    onClose: () => {},
    onLinked: () => {},
    loadChannels: mockLoadChannels,
    onLinkChannel: mockOnLinkChannel,
  },
}

/**
 * 长标题 — 测试弹窗标题溢出
 */
export const LongMatterTitle: Story = {
  args: {
    visible: true,
    matterId: '8575cfce-e60a-4ee6-a3c5-7121cd46490d',
    matterTitle: '这是一个非常非常长的事项标题用来测试弹窗头部文本是否能正确截断和换行显示不会溢出容器边界',
    linkedChannels: [],
    onClose: () => {},
    onLinked: () => {},
    loadChannels: mockLoadChannels,
    onLinkChannel: mockOnLinkChannel,
  },
}

/**
 * 隐藏态 — visible=false
 */
export const Hidden: Story = {
  args: {
    visible: false,
    matterId: '8575cfce',
    linkedChannels: [],
    onClose: () => {},
    onLinked: () => {},
    loadChannels: mockLoadChannels,
    onLinkChannel: mockOnLinkChannel,
  },
}

/**
 * 含子区的混合列表 — 群和子区一起渲染, 子区缩进 + #前缀 + 父群上下文
 */
export const WithThreads: Story = {
  args: {
    visible: true,
    matterId: '8575cfce-e60a-4ee6-a3c5-7121cd46490d',
    matterTitle: 'Octo 产品策略 PPT 打磨',
    linkedChannels: [],
    onClose: () => {},
    onLinked: () => {},
    loadChannels: mockLoadChannels,
    onLinkChannel: mockOnLinkChannel,
  },
}

/**
 * 大量候选 — 30 个群 + 每群 10 个子区 = 330 项, 超过 VISIBLE_ROW_LIMIT,
 * 应只渲染前 200 项并显示提示, 引导用户搜索缩小范围。
 */
export const ManyChannels: Story = {
  args: {
    visible: true,
    matterId: '8575cfce-e60a-4ee6-a3c5-7121cd46490d',
    matterTitle: 'Octo 产品策略 PPT 打磨',
    linkedChannels: [],
    onClose: () => {},
    onLinked: () => {},
    loadChannels: mockLoadChannelsLarge,
    onLinkChannel: mockOnLinkChannel,
  },
}

/**
 * 部分子区加载失败 — 列表上方 surface 警告条 + 重试按钮,
 * 让用户知道为什么某些群"看起来没子区"。
 */
export const PartialThreadLoadFailure: Story = {
  args: {
    visible: true,
    matterId: '8575cfce-e60a-4ee6-a3c5-7121cd46490d',
    matterTitle: 'Octo 产品策略 PPT 打磨',
    linkedChannels: [],
    onClose: () => {},
    onLinked: () => {},
    loadChannels: mockLoadChannelsPartialFailure,
    onLinkChannel: mockOnLinkChannel,
  },
}

/**
 * 多群失败折叠 — 超过 ERROR_NAME_PREVIEW_LIMIT 时, 警告文案折叠成
 * "X、Y、Z 等 N 个群..." 避免横向溢出。
 */
export const ManyThreadLoadFailures: Story = {
  args: {
    visible: true,
    matterId: '8575cfce-e60a-4ee6-a3c5-7121cd46490d',
    matterTitle: 'Octo 产品策略 PPT 打磨',
    linkedChannels: [],
    onClose: () => {},
    onLinked: () => {},
    loadChannels: mockLoadChannelsManyFailures,
    onLinkChannel: mockOnLinkChannel,
  },
}
