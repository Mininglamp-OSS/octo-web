import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { i18n, I18nProvider } from '@octo/base';
import SummaryAddMemberModal from './SummaryAddMemberModal';
import enUS from '../../i18n/en-US.json';
import zhCN from '../../i18n/zh-CN.json';
import type { SummaryMessagingPort } from '../../host';

i18n.registerNamespace('summary', {
    'zh-CN': zhCN,
    'en-US': enUS,
});

const messaging: SummaryMessagingPort = {
    getCurrentUser: () => ({ uid: 'demo-user', displayName: 'Demo User' }),
    loadConversationMembers: async () => [
        { uid: 'u-1', name: 'Alice' },
        { uid: 'u-2', name: 'Bob' },
        { uid: 'u-3', name: 'Carol' },
    ],
    openConversation: async () => {},
    notifySummaryCompleted: async () => {},
    requestForward: () => {},
    subscribeInvalidation: () => () => {},
};

const meta: Meta<typeof SummaryAddMemberModal> = {
    title: 'Summary/SummaryAddMemberModal',
    component: SummaryAddMemberModal,
    parameters: { layout: 'center' },
    decorators: [
        (Story) => (
            <I18nProvider>
                <Story />
            </I18nProvider>
        ),
    ],
};

export default meta;
type Story = StoryObj<typeof SummaryAddMemberModal>;

const baseArgs = {
    visible: true,
    taskId: 9,
    target: { channelId: 'chan-1', channelType: 2 },
    existingMemberIds: ['u-1'],
    messaging,
    onClose: () => console.log('onClose'),
    onSuccess: () => console.log('onSuccess'),
};

export const Default: Story = {
    args: { ...baseArgs },
};
