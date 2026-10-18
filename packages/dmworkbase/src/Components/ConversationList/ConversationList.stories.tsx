import type { Meta, StoryObj } from '@storybook/react-vite'
import React from 'react'
import ConversationList from './index'

const meta: Meta<typeof ConversationList> = {
  title: 'Base/ConversationList',
  component: ConversationList,
  parameters: {
    docs: {
      description: {
        component: 'ConversationList 组件用于显示对话列表。⚠️ 注意：这是一个业务组件，依赖 WKSDK 和全局状态。'
      }
    }
  },
  argTypes: {
    showCategories: {
      control: 'boolean',
      description: '是否显示分类'
    },
    filter: {
      control: 'text',
      description: '搜索过滤器'
    }
  }
}

export default meta

type Story = StoryObj<typeof ConversationList>

export const Default: Story = {
  args: {
    showCategories: true,
    filter: ''
  }
}

export const WithoutCategories: Story = {
  args: {
    showCategories: false,
    filter: ''
  }
}

export const WithSearchFilter: Story = {
  args: {
    showCategories: true,
    filter: 'test'
  }
}

export const LoadingState: Story = {
  args: {
    showCategories: true,
    filter: ''
  }
}
/** Uses the real row renderer and local preview source; no network draft data. */
export const LocalAttachmentDrafts: Story = {
  render: () => <LocalDraftStory />,
};

function LocalDraftStory() {
  const [rows, setRows] = React.useState<import('../../Service/Model').ConversationWrap[]>([]);
  const [selected, setSelected] = React.useState<import('wukongimjssdk').Channel>();
  React.useEffect(() => {
    let active = true;
    let dispose = () => {};
    void Promise.all([
      import('wukongimjssdk'), import('../../App'), import('../../Service/Model'),
      import('../../features/chat-composer/local-drafts/repository'), import('../../bridge/conversationDraftScope'),
    ]).then(async ([sdk, app, model, drafts, scopes]) => {
      if (!active) return;
      const previousUid = app.default.loginInfo.uid;
      app.default.loginInfo.uid = 'local-draft-story';
      const scope = scopes.currentConversationDraftScope();
      dispose = () => {
        app.default.loginInfo.uid = previousUid;
        void drafts.conversationDrafts.clearAccount(scope);
      };
      const items = ['Files and text', 'Selected conversation', 'Long attachment names'].map((title, index) => {
        const channel = new sdk.Channel(`draft-story-${index}`, 1);
        const info = new sdk.ChannelInfo();
        info.channel = channel; info.title = title; info.orgData = { displayName: title };
        sdk.default.shared().channelManager.setChannleInfoForCache(info);
        const conversation = new sdk.Conversation();
        conversation.channel = channel; conversation.timestamp = Date.now() / 1000;
        conversation.remoteExtra = new sdk.ConversationExtra();
        return new model.ConversationWrap(conversation);
      });
      await Promise.all(items.map((item, index) => drafts.conversationDrafts.save(scope,
        { id: item.channel.channelID, type: 1 }, {
          document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Please review' }] }] },
          topAttachments: [
            { id: 'a', name: index === 2 ? 'Quarterly-research-and-product-review-2026-final.zip' : 'FileA.zip', position: 1 },
            { id: 'b', name: 'FileB.md', position: 14 },
          ],
        })));
      if (active) { setRows(items); setSelected(items[1].channel); }
    });
    return () => { active = false; dispose(); };
  }, []);
  return <div style={{ width: 'var(--wk-sidebar-w)' }}>
    <ConversationList conversations={rows} select={selected} onClick={item => setSelected(item.channel)} />
  </div>;
}
