import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { i18n, I18nProvider } from '@octo/base';
import ChatSummaryNewModal from './ChatSummaryNewModal';
import enUS from '../i18n/en-US.json';
import zhCN from '../i18n/zh-CN.json';

// Story 里独立注册 summary namespace（组件用 t() 读取文案）。
// 与 module.tsx init() 的注册等价，仅为 Storybook 单独渲染场景补上。
i18n.registerNamespace('summary', {
    'zh-CN': zhCN,
    'en-US': enUS,
});

/**
 * 聊天窗口内的「新建总结」弹窗。
 *
 * ⚠️ 本次改造点：底部 footer 由单按钮改为双按钮——
 *   [Agent 总结]（次按钮，左）+ [开始总结]（主按钮，右）。
 * 「Agent 总结」把输入框内容作为自然语言需求交给后端 agent（预留接口）。
 *
 * 说明：组件挂载时会尝试拉取远程模板（getTopicTemplates），Storybook 无后端，
 * 该请求会失败并回退到内置模板常量，不影响弹窗与双按钮的展示。
 */
const meta: Meta<typeof ChatSummaryNewModal> = {
    title: 'Summary/ChatSummaryNewModal',
    component: ChatSummaryNewModal,
    parameters: {
        layout: 'fullscreen',
        docs: {
            description: {
                component:
                    '聊天上下文内新建总结弹窗。footer 双按钮：Agent 总结（次）+ 开始总结（主）。',
            },
        },
    },
    decorators: [
        (Story) => (
            <I18nProvider>
                <Story />
            </I18nProvider>
        ),
    ],
};

export default meta;
type Story = StoryObj<typeof ChatSummaryNewModal>;

const baseArgs = {
    visible: true,
    channel: { channelID: 'demo_group_001', channelType: 2 },
    onClose: () => console.log('onClose'),
    onSubmit: (taskId: number) => console.log('onSubmit', taskId),
};

/**
 * 默认态：空输入框，展示模板 + 双按钮（Agent 总结 / 开始总结）。
 */
export const Default: Story = {
    args: { ...baseArgs },
};
