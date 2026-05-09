# 转发到 Matters 功能设计文档

> **分支**: `feat/summary-forward-to-matters`
> **仓库**: `Mininglamp-OSS/octo-web`
> **基线**: `develop @ 17c4ff3f`
> **日期**: 2026-05-09

---

## 1. 需求概述

在智能总结详情页中，增加「转发到 Matters」按钮。用户点击后，选择一个目标 Matter，将当前总结内容以 **Comment** 的形式写入该 Matter。

### 1.1 用户流程

```
总结详情页（已完成状态）
  → 点击「转发到 Matters」按钮
  → 弹出 MatterPickerModal（支持搜索、分页）
  → 选择目标 Matter
  → 确认
  → 调用 addComment API 写入
  → Toast 成功/失败
```

---

## 2. 架构决策

### 2.1 包解耦策略

| 决策 | 说明 |
|------|------|
| **不引入 `@octo/todo` 依赖** | 两个包生命周期独立，避免交叉依赖 |
| **在 `@dmwork/summary` 内新建 `matterBridge.ts`** | 轻量级 API bridge，仅封装 `listMatters` + `addComment` |
| **类型本地化** | 在 summary 包内定义最小类型子集，不从 todo 包 import |

### 2.2 API 响应解包方式

**关键区别**：Matters 服务 **无信封包装**（直接返回 data），Summary 服务有 `{code, message, data}` 信封。

```typescript
// ✅ matterBridge.ts — 直接解包（与 todoApi.ts 一致）
return resp.data;

// ❌ 不能用 summaryApi.ts 的模式
// return resp.data?.data ?? resp.data;
```

### 2.3 Content 处理策略

| 场景 | 处理方式 |
|------|----------|
| 转发到聊天 | strip citations (`[n]`) + splitSummaryText 分段 |
| **转发到 Matters** | **保留 citations + 全文 post（不拆分）** |

理由：
- Matter comment 支持长文本 Markdown，无 IM 消息字数限制
- Citation 角标 `[1]` 在 Matters 上下文中有参考价值
- 不需要像 IM 消息那样分段发送

### 2.4 Content 来源统一

**统一使用 `detail.result?.content`**，与现有 `handleForwardToChat` 保持一致。

理由：
- 现有 `handleForwardToChat`（L421-423）固定读取 `detail.result.content`，不区分 summary_mode
- `detail.result` 在 COMPLETED 状态下始终有值（BY_PERSON 模式完成后也会生成最终 result）
- 保持两个转发入口语义一致，避免维护者困惑
- 如果未来需要让用户选择转发个人/团队总结，应作为独立 feature 在两个按钮上统一扩展

### 2.5 组件风格

`MatterPickerModal` 使用 **class component** 实现，与 `@dmwork/summary` 包内现有 Modal 组件保持一致：
- `MemberSelectorModal` — class component
- `ScheduleConfigModal` — class component
- `ChatSelectorModal` — class component

---

## 3. 文件变更清单

### 3.1 新增文件

| 文件路径 | 职责 |
|----------|------|
| `packages/dmworksummary/src/api/matterBridge.ts` | Matters API bridge（listMatters + addComment） |
| `packages/dmworksummary/src/components/MatterPickerModal.tsx` | Matter 选择器 Modal |
| `packages/dmworksummary/src/components/MatterPickerModal.css` | Modal 样式 |

### 3.2 修改文件

| 文件路径 | 变更内容 |
|----------|----------|
| `packages/dmworksummary/src/pages/SummaryDetailPage.tsx` | 新增按钮 + handler + state 字段 |

---

## 4. 详细设计

### 4.1 `matterBridge.ts`

```typescript
import axios from 'axios';
import { WKApp } from '@octo/base';

// ─── 本地类型定义（最小子集）────────────────────────────

export type MatterStatus = 'open' | 'done' | 'archived';

export interface MatterBrief {
  id: string;
  title: string;
  status: MatterStatus;
  creator_id: string;
  created_at: string;
  updated_at: string;
}

export interface MatterListParams {
  status?: MatterStatus;
  q?: string;
  limit?: number;
  cursor?: string;
}

export interface Pagination {
  has_more: boolean;
  next_cursor?: string;
}

export interface PaginatedList<T> {
  data: T[];
  pagination: Pagination;
}

// ─── Axios 实例（与 todoApi.ts 完全一致的模式）─────────

const matterAxios = axios.create({ baseURL: '' });

matterAxios.interceptors.request.use((config) => {
  const token = WKApp.loginInfo.token;
  if (token) {
    config.headers = config.headers ?? {};
    config.headers['token'] = token;
  }
  const spaceId = WKApp.shared.currentSpaceId;
  if (spaceId) {
    config.headers = config.headers ?? {};
    config.headers['X-Space-Id'] = spaceId;
  }
  return config;
});

matterAxios.interceptors.response.use(undefined, (err) => {
  if (err?.response?.status === 401) {
    WKApp.shared.logout();
  }
  return Promise.reject(err);
});

// ─── 路径 & 工具函数 ────────────────────────────────────

const BASE = '/matter/api/v1';

function extractErrorMessage(err: unknown): string {
  const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
  const msg = axiosErr?.response?.data?.error?.message;
  const raw = msg || (err instanceof Error ? err.message : 'Request failed');
  return raw.length > 200 ? raw.slice(0, 200) + '…' : raw;
}

function buildParams(obj?: Record<string, unknown>): Record<string, string> {
  if (!obj) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) {
      result[key] = String(value);
    }
  }
  return result;
}

// ─── API 接口 ───────────────────────────────────────────

/**
 * 获取 Matter 列表（支持搜索 + 游标分页）
 * 注意：Matters 服务无信封包装，直接返回 resp.data
 */
export async function listMatters(params?: MatterListParams): Promise<PaginatedList<MatterBrief>> {
  try {
    const resp = await matterAxios.get(`${BASE}/matters`, {
      params: buildParams(params as unknown as Record<string, unknown>),
    });
    return resp.data;
  } catch (err) {
    throw new Error(extractErrorMessage(err));
  }
}

/**
 * 向 Matter 添加 Comment
 * content: 全文 Markdown（保留 citations，不拆分）
 */
export async function addComment(matterId: string, content: string): Promise<void> {
  const trimmed = content?.trim();
  if (!trimmed) {
    throw new Error('Comment content cannot be empty');
  }
  try {
    await matterAxios.post(`${BASE}/matters/${matterId}/comments`, { content: trimmed });
  } catch (err) {
    throw new Error(extractErrorMessage(err));
  }
}
```

### 4.2 `MatterPickerModal.tsx`

```typescript
import React, { Component } from 'react';
import { Modal, Input, Spin, Toast } from '@douyinfe/semi-ui';
import { IconSearch } from '@douyinfe/semi-icons';
import * as matterBridge from '../api/matterBridge';
import type { MatterBrief } from '../api/matterBridge';
import './MatterPickerModal.css';

interface MatterPickerModalProps {
  visible: boolean;
  onSelect: (matterId: string, matterTitle: string) => void;
  onCancel: () => void;
}

interface MatterPickerModalState {
  matters: MatterBrief[];
  loading: boolean;
  keyword: string;
  hasMore: boolean;
  selectedId: string | null;
}

const PAGE_SIZE = 50;
const DEBOUNCE_MS = 300;

export default class MatterPickerModal extends Component<MatterPickerModalProps, MatterPickerModalState> {
  state: MatterPickerModalState = {
    matters: [],
    loading: false,
    keyword: '',
    hasMore: false,
    selectedId: null,
  };

  private cursor: string | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  componentDidUpdate(prevProps: MatterPickerModalProps) {
    // 打开时加载
    if (this.props.visible && !prevProps.visible) {
      this.reset();
      this.load('', false);
    }
  }

  componentWillUnmount() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  private reset() {
    this.cursor = undefined;
    this.setState({ matters: [], keyword: '', hasMore: false, selectedId: null });
  }

  private async load(searchKey: string, append: boolean) {
    this.setState({ loading: true });
    try {
      const resp = await matterBridge.listMatters({
        status: 'open',
        q: searchKey || undefined,
        limit: PAGE_SIZE,
        cursor: append ? this.cursor : undefined,
      });
      this.cursor = resp.pagination.next_cursor;
      this.setState((prev) => ({
        matters: append ? [...prev.matters, ...resp.data] : resp.data,
        hasMore: resp.pagination.has_more,
        loading: false,
      }));
    } catch (err: any) {
      Toast.error(err.message || '加载事项失败');
      this.setState({ loading: false });
    }
  }

  handleKeywordChange = (val: string) => {
    this.setState({ keyword: val, selectedId: null });
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.cursor = undefined;
      this.load(val, false);
    }, DEBOUNCE_MS);
  };

  handleConfirm = () => {
    const { selectedId, matters } = this.state;
    if (!selectedId) return;
    const matter = matters.find(m => m.id === selectedId);
    if (matter) {
      this.props.onSelect(matter.id, matter.title);
    }
  };

  handleLoadMore = () => {
    const { hasMore, loading, keyword } = this.state;
    if (hasMore && !loading) {
      this.load(keyword, true);
    }
  };

  render() {
    const { visible, onCancel } = this.props;
    const { matters, loading, keyword, hasMore, selectedId } = this.state;

    return (
      <Modal
        title="选择目标事项"
        visible={visible}
        onOk={this.handleConfirm}
        onCancel={onCancel}
        okText="确定"
        cancelText="取消"
        okButtonProps={{ disabled: !selectedId }}
        width={480}
        className="matter-picker-modal"
      >
        <Input
          prefix={<IconSearch />}
          placeholder="搜索事项..."
          value={keyword}
          onChange={this.handleKeywordChange}
          showClear
          style={{ marginBottom: 12 }}
        />

        <div className="matter-picker-list" style={{ maxHeight: 320, overflowY: 'auto' }}>
          {loading && matters.length === 0 ? (
            <div className="matter-picker-loading">
              <Spin />
            </div>
          ) : matters.length === 0 ? (
            <div className="matter-picker-empty">暂无可用事项</div>
          ) : (
            <>
              {matters.map((matter) => (
                <div
                  key={matter.id}
                  className={`matter-picker-item ${selectedId === matter.id ? 'selected' : ''}`}
                  onClick={() => this.setState({ selectedId: matter.id })}
                >
                  <span className="matter-picker-item-title">{matter.title}</span>
                  <span className={`matter-picker-item-status status-${matter.status}`}>
                    {matter.status}
                  </span>
                </div>
              ))}
              {hasMore && (
                <div className="matter-picker-load-more" onClick={this.handleLoadMore}>
                  {loading ? <Spin size="small" /> : '加载更多...'}
                </div>
              )}
            </>
          )}
        </div>
      </Modal>
    );
  }
}
```

### 4.3 `SummaryDetailPage.tsx` 变更

#### 4.3.1 新增 State 字段

```typescript
interface SummaryDetailPageState {
  // ... 现有字段 ...
  showMatterPicker: boolean;
  forwardingToMatter: boolean;
}
```

初始值：
```typescript
showMatterPicker: false,
forwardingToMatter: false,
```

#### 4.3.2 新增 Import

```typescript
import MatterPickerModal from '../components/MatterPickerModal';
import * as matterBridge from '../api/matterBridge';
```

#### 4.3.3 新增 Handler

```typescript
handleForwardToMatter = () => {
    const { detail } = this.state;
    if (!detail || detail.status !== TaskStatus.COMPLETED) return;

    // 与 handleForwardToChat 保持一致，统一使用 detail.result.content
    const content = detail.result?.content;
    if (!content?.trim()) {
        Toast.warning('暂无可转发的内容');
        return;
    }

    this.setState({ showMatterPicker: true });
};

handleMatterSelected = async (matterId: string, matterTitle: string) => {
    const { detail } = this.state;
    if (!detail) return;

    const content = detail.result?.content;
    if (!content?.trim()) return;

    this.setState({ forwardingToMatter: true, showMatterPicker: false });
    try {
        await matterBridge.addComment(matterId, content);
        Toast.success(`已转发到「${matterTitle}」`);
    } catch (err: any) {
        Toast.error(err.message || '转发失败');
    } finally {
        this.setState({ forwardingToMatter: false });
    }
};
```

#### 4.3.4 新增按钮（render 中，紧跟「转发到聊天」按钮之后）

```tsx
{detail.status === TaskStatus.COMPLETED && (
    <Button
        icon={<IconSend />}
        onClick={this.handleForwardToMatter}
        loading={this.state.forwardingToMatter}
        disabled={this.state.forwardingToMatter}
    >
        转发到 Matters
    </Button>
)}
```

#### 4.3.5 新增 Modal（render 最外层末尾）

```tsx
<MatterPickerModal
    visible={this.state.showMatterPicker}
    onSelect={this.handleMatterSelected}
    onCancel={() => this.setState({ showMatterPicker: false })}
/>
```

---

## 5. 样式文件

### 5.1 `MatterPickerModal.css`

```css
.matter-picker-modal .matter-picker-list {
  border: 1px solid var(--semi-color-border);
  border-radius: 6px;
  padding: 4px;
}

.matter-picker-loading,
.matter-picker-empty {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 24px;
  color: var(--semi-color-text-2);
  font-size: 13px;
}

.matter-picker-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 150ms;
}

.matter-picker-item:hover {
  background: var(--semi-color-fill-0);
}

.matter-picker-item.selected {
  background: var(--semi-color-primary-light-default);
  border: 1px solid var(--semi-color-primary);
}

.matter-picker-item-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  color: var(--semi-color-text-0);
}

.matter-picker-item-status {
  flex-shrink: 0;
  margin-left: 8px;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 3px;
}

.matter-picker-item-status.status-open {
  color: var(--semi-color-success);
  background: var(--semi-color-success-light-default);
}

.matter-picker-item-status.status-done {
  color: var(--semi-color-text-2);
  background: var(--semi-color-fill-1);
}

.matter-picker-load-more {
  text-align: center;
  padding: 8px;
  font-size: 12px;
  color: var(--semi-color-primary);
  cursor: pointer;
}
```

---

## 6. 边界条件处理

| 场景 | 处理 |
|------|------|
| 总结未完成 | 按钮不显示 |
| 总结内容为空 | 点击后 Toast warning，不弹 Modal |
| 网络错误 | catch → Toast.error 展示后端错误信息 |
| 401 token 过期 | interceptor 自动 logout |
| 用户无可用 Matter | Modal 内展示「暂无可用事项」空态 |
| 重复点击 | Button loading + disabled 防重复 |

---

## 7. 部署 Checklist

- [ ] **Vite dev proxy** 已配置 `/matter/api/v1` → matters service（已有）
- [ ] **生产 nginx** 需确认有对应 `/matter/` rewrite 规则
- [ ] 无需数据库迁移
- [ ] 无需后端改动（复用现有 addComment API）

---

## 8. 测试计划

| 类型 | 范围 |
|------|------|
| 单元测试 | `matterBridge.ts`：request header、params 构建、error 提取、空内容拒绝 |
| 组件测试 | `MatterPickerModal`：搜索 debounce、选中/取消、空态、加载更多 |
| 手动验证 | 端到端：创建总结 → 完成 → 转发到 Matter → 在 Matter 详情页验证 comment |

---

## 9. 工作量估计

| 文件 | 行数 |
|------|------|
| `matterBridge.ts` | ~80 行 |
| `MatterPickerModal.tsx` | ~130 行 |
| `MatterPickerModal.css` | ~70 行 |
| `SummaryDetailPage.tsx` 改动 | ~50 行 |
| **合计** | **~330 行** |
