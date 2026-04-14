import type { Meta, StoryObj } from '@storybook/react-vite'
import React, { useState } from 'react'
import { Button, Input } from '@douyinfe/semi-ui'

import ViewToggle from '../../../../packages/dmworkbase/src/Components/ViewToggle'
import ConversationListGrouped from '../../../../packages/dmworkbase/src/Components/ConversationListGrouped'
import CategoryHeader from '../../../../packages/dmworkbase/src/Components/CategoryHeader'
import AddCategoryButton from '../../../../packages/dmworkbase/src/Components/AddCategoryButton'
import CreateCategoryModal from '../../../../packages/dmworkbase/src/Components/CreateCategoryModal'
import DeleteCategoryModal from '../../../../packages/dmworkbase/src/Components/DeleteCategoryModal'
import MoveToGroupMenu from '../../../../packages/dmworkbase/src/Components/MoveToGroupMenu'
import CategorySection from '../../../../packages/dmworkbase/src/Components/CategorySection'
import UngroupedSection from '../../../../packages/dmworkbase/src/Components/UngroupedSection'
import CategoryEmptyState from '../../../../packages/dmworkbase/src/Components/CategoryEmptyState'

import ConversationListWithCategory from '../../../../packages/dmworkbase/src/Components/ConversationListWithCategory'

// ── ModalShell：模拟弹窗外壳（直接在 Story 渲染，不用 Portal）──
function ModalShell({
  title,
  children,
  footer,
  width = 360,
}: {
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
  width?: number
}) {
  return (
    <div style={{
      width, border: '1px solid var(--wk-border-default)',
      borderRadius: 12, background: 'var(--wk-bg-surface)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.16)', overflow: 'hidden',
      fontFamily: 'var(--wk-font-sans)',
    }}>
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid var(--wk-border-subtle)',
        fontSize: 15, fontWeight: 600, color: 'var(--wk-text-primary)',
      }}>{title}</div>
      <div style={{ padding: '16px 20px' }}>{children}</div>
      {footer && (
        <div style={{
          padding: '12px 20px', borderTop: '1px solid var(--wk-border-subtle)',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>{footer}</div>
      )}
    </div>
  )
}

// ── CreateCategoryModal 静态 Demo（直接展示内部状态）──
function CreateCategoryModalStaticDemo({
  initialValue = '',
  initialLoading = false,
  initialError = null,
  initialDuplicate = false,
}: {
  initialValue?: string
  initialLoading?: boolean
  initialError?: string | null
  initialDuplicate?: boolean
}) {
  const hasError = initialDuplicate || !!initialError
  const isDisabled = !initialValue || initialDuplicate
  return (
    <ModalShell
      title="新建分组"
      footer={
        <>
          <Button>取消</Button>
          <Button
            type="primary"
            disabled={isDisabled && !initialLoading}
            loading={initialLoading}
            style={{ opacity: isDisabled && !initialLoading ? 0.5 : 1 }}
          >
            确认
          </Button>
        </>
      }
    >
      <Input
        value={initialValue}
        onChange={() => {}}
        placeholder="例如：工作、学习、兴趣、项目名"
        validateStatus={hasError ? 'error' : undefined}
      />
      {hasError && (
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--wk-color-error)' }}>
          {initialDuplicate ? '该分组名已存在' : initialError}
        </div>
      )}
    </ModalShell>
  )
}

// ── Mock 会话占位 ──
const MockConvItem = ({ name, unread }: { name: string; unread?: number }) => (
  <div style={{
    display: 'flex', alignItems: 'center', height: 56, padding: '0 12px', gap: 10,
    borderRadius: 8, cursor: 'pointer',
  }}
    onMouseEnter={e => (e.currentTarget.style.background = 'var(--wk-bg-hover)')}
    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
  >
    <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--wk-bg-elevated)', flexShrink: 0 }} />
    <div style={{ flex: 1, overflow: 'hidden' }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--wk-text-primary)' }}>{name}</div>
      <div style={{ fontSize: 12, color: 'var(--wk-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        最新消息内容...
      </div>
    </div>
    {!!unread && (
      <div style={{
        minWidth: 16, height: 16, padding: '0 4px', borderRadius: 9999,
        background: 'var(--wk-color-danger)', color: '#fff',
        fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{unread > 99 ? '99+' : unread}</div>
    )}
  </div>
)

const Wrap = ({ children, width = 280 }: { children: React.ReactNode; width?: number }) => (
  <div style={{ width, fontFamily: 'var(--wk-font-sans)', padding: 16 }}>
    {children}
  </div>
)

// ══════════════════════════════════════════════
// 1. ViewToggle
// ══════════════════════════════════════════════

const ViewToggleMeta: Meta<typeof ViewToggle> = {
  title: 'GroupCategory/ViewToggle',
  component: ViewToggle,
  parameters: { layout: 'centered' },
}
export default ViewToggleMeta

export const AllSelected: StoryObj<typeof ViewToggle> = {
  name: '默认态（选中「全部」）',
  render: () => {
    const [v, setV] = useState<'all' | 'grouped'>('all')
    return <ViewToggle value={v} onChange={setV} />
  },
}

export const GroupedSelected: StoryObj<typeof ViewToggle> = {
  name: '选中「分组」态',
  render: () => {
    const [v, setV] = useState<'all' | 'grouped'>('grouped')
    return <ViewToggle value={v} onChange={setV} />
  },
}

// ══════════════════════════════════════════════
// 2. CategoryHeader
// ══════════════════════════════════════════════

export const CategoryHeaderExpandedUnread: StoryObj = {
  name: 'CategoryHeader / 展开·有未读',
  render: () => (
    <Wrap>
      <CategoryHeader name="工作" unreadCount={5} isCollapsed={false} onToggle={() => {}} onContextMenu={() => {}} />
    </Wrap>
  ),
}

export const CategoryHeaderExpandedNoUnread: StoryObj = {
  name: 'CategoryHeader / 展开·无未读',
  render: () => (
    <Wrap>
      <CategoryHeader name="生活" isCollapsed={false} onToggle={() => {}} onContextMenu={() => {}} />
    </Wrap>
  ),
}

export const CategoryHeaderCollapsedUnread: StoryObj = {
  name: 'CategoryHeader / 折叠·有未读',
  render: () => (
    <Wrap>
      <CategoryHeader name="项目 A" unreadCount={12} isCollapsed={true} onToggle={() => {}} onContextMenu={() => {}} />
    </Wrap>
  ),
}

export const CategoryHeaderCollapsedNoUnread: StoryObj = {
  name: 'CategoryHeader / 折叠·无未读',
  render: () => (
    <Wrap>
      <CategoryHeader name="学习" isCollapsed={true} onToggle={() => {}} onContextMenu={() => {}} />
    </Wrap>
  ),
}

export const CategoryHeaderEmpty: StoryObj = {
  name: 'CategoryHeader / 空分组态',
  render: () => (
    <Wrap>
      <CategoryHeader name="旧项目" isCollapsed={false} isEmpty={true} onToggle={() => {}} onContextMenu={() => {}} />
    </Wrap>
  ),
}

export const CategoryHeaderEditing: StoryObj = {
  name: 'CategoryHeader / 行内重命名编辑态',
  render: () => (
    <Wrap>
      <CategoryHeader
        name="工作"
        unreadCount={5}
        isCollapsed={false}
        isEditing={true}
        onToggle={() => {}}
        onContextMenu={() => {}}
        onRenameConfirm={(val) => console.log('confirm', val)}
        onRenameCancel={() => console.log('cancel')}
      />
    </Wrap>
  ),
}

// ══════════════════════════════════════════════
// 3. AddCategoryButton
// ══════════════════════════════════════════════

export const AddCategoryButtonDefault: StoryObj = {
  name: 'AddCategoryButton / 默认态',
  render: () => (
    <Wrap>
      <AddCategoryButton onClick={() => alert('新建分组')} />
    </Wrap>
  ),
}

// ══════════════════════════════════════════════
// 4. CreateCategoryModal
// ══════════════════════════════════════════════

export const CreateCategoryModalDefault: StoryObj = {
  name: 'CreateCategoryModal / 默认态（按钮禁用）',
  render: () => {
    const [visible, setVisible] = useState(true)
    return (
      <div>
        <button onClick={() => setVisible(true)}>打开弹窗</button>
        <CreateCategoryModal
          visible={visible}
          onConfirm={async (name) => { alert(`创建: ${name}`); setVisible(false) }}
          onCancel={() => setVisible(false)}
          existingNames={[]}
        />
      </div>
    )
  },
}

export const CreateCategoryModalDuplicate: StoryObj = {
  name: 'CreateCategoryModal / 重复名提示',
  render: () => <CreateCategoryModalStaticDemo initialValue="工作" initialDuplicate />,
}

export const CreateCategoryModalLoading: StoryObj = {
  name: 'CreateCategoryModal / 加载中',
  render: () => <CreateCategoryModalStaticDemo initialValue="工作" initialLoading />,
}

export const CreateCategoryModalFail: StoryObj = {
  name: 'CreateCategoryModal / 失败态',
  render: () => <CreateCategoryModalStaticDemo initialValue="工作" initialError="创建失败，请重试" />,
}

// ══════════════════════════════════════════════
// 5. DeleteCategoryModal
// ══════════════════════════════════════════════

export const DeleteCategoryModalDefault: StoryObj = {
  name: 'DeleteCategoryModal / 默认态',
  render: () => {
    const [visible, setVisible] = useState(true)
    return (
      <div>
        <button onClick={() => setVisible(true)}>打开弹窗</button>
        <DeleteCategoryModal
          visible={visible}
          categoryName="工作"
          groupCount={3}
          onConfirm={async () => setVisible(false)}
          onCancel={() => setVisible(false)}
        />
      </div>
    )
  },
}

export const DeleteCategoryModalLoading: StoryObj = {
  name: 'DeleteCategoryModal / 加载中',
  render: () => (
    <ModalShell
      title="删除分组「项目 A」？"
      footer={
        <>
          <Button>取消</Button>
          <Button type="danger" loading>确认删除</Button>
        </>
      }
    >
      <p style={{ margin: 0, color: 'var(--wk-text-secondary)', fontSize: 13, lineHeight: 1.6 }}>
        删除后，该分组下的 <strong>1</strong> 个群聊将移到「未分组」中。群聊本身不会被删除。
      </p>
    </ModalShell>
  ),
}

// ══════════════════════════════════════════════
// 6. MoveToGroupMenu
// ══════════════════════════════════════════════

export const MoveToGroupMenuWithCategories: StoryObj = {
  name: 'MoveToGroupMenu / 有分组列表',
  render: () => (
    <Wrap width={200}>
      <MoveToGroupMenu
        categories={[{ id: '1', name: '工作' }, { id: '2', name: '生活' }, { id: '3', name: '学习' }]}
        onSelect={(id) => alert(`移到分组 ${id}`)}
        onCreateNew={() => alert('新建分组')}
      />
    </Wrap>
  ),
}

export const MoveToGroupMenuEmpty: StoryObj = {
  name: 'MoveToGroupMenu / 无分组（只有「新建分组」）',
  render: () => (
    <Wrap width={200}>
      <MoveToGroupMenu categories={[]} onSelect={() => {}} onCreateNew={() => alert('新建分组')} />
    </Wrap>
  ),
}

// ══════════════════════════════════════════════
// 7. CategorySection
// ══════════════════════════════════════════════

export const CategorySectionExpanded: StoryObj = {
  name: 'CategorySection / 展开·有内容',
  render: () => {
    const [collapsed, setCollapsed] = useState(false)
    return (
      <Wrap>
        <CategorySection
          category={{ id: '1', name: '工作', unreadCount: 5 }}
          isCollapsed={collapsed}
          onToggle={() => setCollapsed(v => !v)}
          onContextMenu={() => {}}
        >
          <MockConvItem name="产品讨论群" unread={3} />
          <MockConvItem name="研发同学群" unread={2} />
          <MockConvItem name="设计评审" />
        </CategorySection>
      </Wrap>
    )
  },
}

export const CategorySectionCollapsed: StoryObj = {
  name: 'CategorySection / 折叠态',
  render: () => {
    const [collapsed, setCollapsed] = useState(true)
    return (
      <Wrap>
        <CategorySection
          category={{ id: '1', name: '工作', unreadCount: 5 }}
          isCollapsed={collapsed}
          onToggle={() => setCollapsed(v => !v)}
          onContextMenu={() => {}}
        >
          <MockConvItem name="产品讨论群" />
          <MockConvItem name="研发同学群" />
        </CategorySection>
      </Wrap>
    )
  },
}

export const CategorySectionEmptyGroup: StoryObj = {
  name: 'CategorySection / 空分组态',
  render: () => (
    <Wrap>
      <CategorySection category={{ id: '1', name: '旧项目' }} isCollapsed={false} onToggle={() => {}} onContextMenu={() => {}} />
    </Wrap>
  ),
}

// ══════════════════════════════════════════════
// 8. UngroupedSection
// ══════════════════════════════════════════════

export const UngroupedSectionWithConvs: StoryObj = {
  name: 'UngroupedSection / 有群聊',
  render: () => (
    <Wrap>
      <UngroupedSection>
        <MockConvItem name="临时沟通群" />
        <MockConvItem name="活动通知" unread={1} />
      </UngroupedSection>
    </Wrap>
  ),
}

// ══════════════════════════════════════════════
// 9. CategoryEmptyState
// ══════════════════════════════════════════════

export const CategoryEmptyStateStory: StoryObj = {
  name: 'CategoryEmptyState / 空状态引导',
  render: () => (
    <Wrap width={320}>
      <CategoryEmptyState onCreateCategory={() => alert('新建分组')} />
    </Wrap>
  ),
}

// ══════════════════════════════════════════════
// 11. ConversationListWithCategory
// ══════════════════════════════════════════════

const MOCK_CONV_CATEGORIES = [
  {
    id: '1',
    name: '工作',
    unreadCount: 5,
    conversations: (
      <>
        <MockConvItem name="产品讨论群" unread={3} />
        <MockConvItem name="研发同学群" unread={2} />
        <MockConvItem name="设计评审" />
      </>
    ),
  },
  {
    id: '2',
    name: '生活',
    conversations: (
      <>
        <MockConvItem name="家庭群" />
        <MockConvItem name="老同学" />
      </>
    ),
  },
]

const ALL_CONVS = (
  <>
    <MockConvItem name="产品讨论群" unread={3} />
    <MockConvItem name="家庭群" />
    <MockConvItem name="研发同学群" unread={2} />
    <MockConvItem name="老同学" />
    <MockConvItem name="设计评审" />
  </>
)

export const ConvWithCategoryAllView: StoryObj = {
  name: 'ConversationListWithCategory / 全部视图',
  render: () => {
    const [mode, setMode] = useState<'all' | 'grouped'>('all')
    return (
      <div style={{ width: 280, height: 500, border: '1px solid var(--wk-border-default)', borderRadius: 12, overflow: 'hidden' }}>
        <ConversationListWithCategory
          viewMode={mode}
          onViewModeChange={setMode}
          allConversations={ALL_CONVS}
          categories={MOCK_CONV_CATEGORIES}
          onCreateCategory={() => alert('新建分组')}
        />
      </div>
    )
  },
}

export const ConvWithCategoryGroupedView: StoryObj = {
  name: 'ConversationListWithCategory / 分组视图·有分组',
  render: () => {
    const [mode, setMode] = useState<'all' | 'grouped'>('grouped')
    return (
      <div style={{ width: 280, height: 500, border: '1px solid var(--wk-border-default)', borderRadius: 12, overflow: 'hidden' }}>
        <ConversationListWithCategory
          viewMode={mode}
          onViewModeChange={setMode}
          allConversations={ALL_CONVS}
          categories={MOCK_CONV_CATEGORIES}
          onCreateCategory={() => alert('新建分组')}
        />
      </div>
    )
  },
}

export const ConvWithCategoryEmpty: StoryObj = {
  name: 'ConversationListWithCategory / 分组视图·空状态',
  render: () => {
    const [mode, setMode] = useState<'all' | 'grouped'>('grouped')
    return (
      <div style={{ width: 280, height: 500, border: '1px solid var(--wk-border-default)', borderRadius: 12, overflow: 'hidden' }}>
        <ConversationListWithCategory
          viewMode={mode}
          onViewModeChange={setMode}
          allConversations={ALL_CONVS}
          categories={[]}
          onCreateCategory={() => alert('新建分组')}
        />
      </div>
    )
  },
}

export const ConvWithCategoryLoading: StoryObj = {
  name: 'ConversationListWithCategory / 分组视图·加载中',
  render: () => (
    <div style={{ width: 280, height: 500, border: '1px solid var(--wk-border-default)', borderRadius: 12, overflow: 'hidden' }}>
      <ConversationListWithCategory
        viewMode="grouped"
        onViewModeChange={() => {}}
        isLoading={true}
        categories={[]}
      />
    </div>
  ),
}

export const ConvWithCategoryError: StoryObj = {
  name: 'ConversationListWithCategory / 分组视图·加载失败',
  render: () => (
    <div style={{ width: 280, height: 500, border: '1px solid var(--wk-border-default)', borderRadius: 12, overflow: 'hidden' }}>
      <ConversationListWithCategory
        viewMode="grouped"
        onViewModeChange={() => {}}
        error="网络异常，分组数据加载失败"
        categories={[]}
        onRetry={() => alert('重试')}
      />
    </div>
  ),
}

// ══════════════════════════════════════════════
// 12. ConversationListGrouped（受控 Mock，不调真实接口）
// ══════════════════════════════════════════════

const MOCK_CATEGORY_ITEMS = [
  { category_id: 'cat-1', name: '工作', sort: 0, groups: [{ group_no: 'g-1', name: '产品讨论群', category_sort: 0 }, { group_no: 'g-2', name: '研发同学群', category_sort: 1 }] },
  { category_id: 'cat-2', name: '生活', sort: 1, groups: [{ group_no: 'g-3', name: '家庭群', category_sort: 0 }] },
]

// Mock 会话 wrap（最小结构）
const makeMockChannel = (id: string, channelType = 2) => ({
  channelID: id,
  channelType,
  getChannelKey: () => `${id}-${channelType}`,
})

const makeMockConv = (id: string, name: string, unread = 0, channelType = 2 /* ChannelTypeGroup */) => ({
  channel: makeMockChannel(id, channelType),
  channelInfo: { top: false, mute: false, orgData: { name } },
  unread,
  lastMessage: null,
  conversation: { channel: makeMockChannel(id, channelType), unread, timestamp: Date.now() },
}) as any

const MOCK_CONVERSATIONS = [
  makeMockConv('g-1', '产品讨论群', 3),
  makeMockConv('g-2', '研发同学群', 0),
  makeMockConv('g-3', '家庭群', 1),
  makeMockConv('g-4', '临时群', 0),
]

export const ConversationListGroupedWithCategories: StoryObj = {
  name: 'ConversationListGrouped / 有分组·分组视图（Mock 数据）',
  render: () => (
    <div style={{ width: 280, height: 600, border: '1px solid var(--wk-border-default)', borderRadius: 12, overflow: 'hidden' }}>
      <ConversationListGrouped
        conversations={MOCK_CONVERSATIONS}
        categories={MOCK_CATEGORY_ITEMS}
        isLoading={false}
        error={null}
        onRetry={() => {}}
        onConversationClick={() => {}}
        onClearMessages={() => {}}
        onThreadOverflowClick={() => {}}
        onRenameCategory={async () => {}}
        onDeleteCategory={() => {}}
        onSortCategories={async () => {}}
        onMoveGroupToCategory={async () => {}}
        onOpenCreateCategory={() => alert('新建分组')}
      />
    </div>
  ),
}

export const ConversationListGroupedWithCheckmark: StoryObj = {
  name: 'ConversationListGrouped / 右键子菜单·当前分组有 ✓ 标识',
  render: () => (
    <div style={{ padding: 16, fontFamily: 'var(--wk-font-sans)' }}>
      <p style={{ fontSize: 12, color: 'var(--wk-text-tertiary)', marginBottom: 12 }}>
        右键「产品讨论群」（已在「工作」分组）→「移到分组」子菜单，「工作」前有 ✓
      </p>
      <div style={{ width: 280, height: 500, border: '1px solid var(--wk-border-default)', borderRadius: 12, overflow: 'hidden' }}>
        <ConversationListGrouped
          conversations={MOCK_CONVERSATIONS}
          categories={MOCK_CATEGORY_ITEMS}
          isLoading={false}
          error={null}
          onRetry={() => {}}
          onConversationClick={() => {}}
          onClearMessages={() => {}}
          onThreadOverflowClick={() => {}}
          onRenameCategory={async () => {}}
          onDeleteCategory={() => {}}
          onSortCategories={async () => {}}
          onMoveGroupToCategory={async () => {}}
          onOpenCreateCategory={() => alert('新建分组')}
        />
      </div>
    </div>
  ),
}

export const ConversationListGroupedLoading: StoryObj = {
  name: 'ConversationListGrouped / 加载中',
  render: () => (
    <div style={{ width: 280, height: 500, border: '1px solid var(--wk-border-default)', borderRadius: 12, overflow: 'hidden' }}>
      <ConversationListGrouped
        conversations={[]}
        categories={[]}
        isLoading={true}
        error={null}
        onRetry={() => {}}
        onConversationClick={() => {}}
        onClearMessages={() => {}}
        onThreadOverflowClick={() => {}}
        onRenameCategory={async () => {}}
        onDeleteCategory={() => {}}
        onSortCategories={async () => {}}
        onMoveGroupToCategory={async () => {}}
        onOpenCreateCategory={() => {}}
      />
    </div>
  ),
}

export const ConversationListGroupedError: StoryObj = {
  name: 'ConversationListGrouped / 加载失败',
  render: () => (
    <div style={{ width: 280, height: 500, border: '1px solid var(--wk-border-default)', borderRadius: 12, overflow: 'hidden' }}>
      <ConversationListGrouped
        conversations={[]}
        categories={[]}
        isLoading={false}
        error="网络异常，分组数据加载失败"
        onRetry={() => alert('重试')}
        onConversationClick={() => {}}
        onClearMessages={() => {}}
        onThreadOverflowClick={() => {}}
        onRenameCategory={async () => {}}
        onDeleteCategory={() => {}}
        onSortCategories={async () => {}}
        onMoveGroupToCategory={async () => {}}
        onOpenCreateCategory={() => {}}
      />
    </div>
  ),
}
