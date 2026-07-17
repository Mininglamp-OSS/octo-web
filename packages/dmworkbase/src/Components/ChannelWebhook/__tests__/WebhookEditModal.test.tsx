/**
 * @vitest-environment jsdom
 *
 * WebhookEditModal tests — cover the #465 mention_uids picker wiring:
 * member options from the channel (bots flagged), create sends mention_uids,
 * and editing to empty sends an explicit [] (clear). The req-construction edge
 * cases themselves live in IncomingWebhook.test.ts (pure buildWebhookUpsertReq).
 *
 * React 17 + ReactDOM.render pattern (matches WebhookUrlModal.test.tsx).
 */
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { i18n } from '../../../i18n';

const hoisted = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({ webhook_id: 'iwh_new', token: 't', url: '/u' }),
  update: vi.fn().mockResolvedValue(undefined),
  subscribers: [] as any[],
}));

// 自定义 Select mock：把每个 Option 渲染成可点击按钮（点击切换 value，多选语义）。
// 若组件传了 renderOptionItem，则用它渲染按钮内容，覆盖真实下拉行（含 AI 徽章）。
vi.mock('@douyinfe/semi-ui', () => {
  const Select: any = ({ value, onChange, children, renderOptionItem }: any) =>
    React.createElement(
      'div',
      { 'data-testid': 'select', 'data-value': (value || []).join(',') },
      React.Children.map(children, (child: any) => {
        const v = child.props.value;
        const toggle = () => {
          const cur: string[] = value || [];
          onChange(cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);
        };
        const content = renderOptionItem
          ? renderOptionItem({
              value: v,
              label: child.props.label,
              selected: (value || []).includes(v),
              focused: false,
              onClick: () => {},
              onMouseEnter: () => {},
            })
          : child.props.children;
        return React.createElement(
          'button',
          { 'data-testid': `opt-${v}`, onClick: toggle },
          content
        );
      })
    );
  Select.Option = ({ children }: any) => React.createElement(React.Fragment, null, children);
  const Switch = ({ checked, onChange }: any) =>
    React.createElement('button', {
      'data-testid': 'switch',
      'data-checked': String(!!checked),
      onClick: () => onChange(!checked),
    });
  return { Select, Switch, Toast: { success: vi.fn(), error: vi.fn() } };
});

vi.mock('@douyinfe/semi-icons', () => ({
  IconAlertTriangle: () => React.createElement('span', { 'data-testid': 'icon-alert' }),
}));

vi.mock('../../WKModal', () => ({
  default: ({ children, footer, visible }: any) =>
    visible
      ? React.createElement('div', { 'data-testid': 'modal' }, children, footer)
      : null,
  __esModule: true,
}));

vi.mock('../../WKButton', () => ({
  default: ({ children, onClick }: any) =>
    React.createElement('button', { onClick }, children),
  __esModule: true,
}));

vi.mock('../../../App', () => ({
  default: {
    loginInfo: { uid: 'me' },
    dataSource: {
      channelDataSource: {
        createIncomingWebhook: (...a: any[]) => hoisted.create(...a),
        updateIncomingWebhook: (...a: any[]) => hoisted.update(...a),
      },
    },
  },
  __esModule: true,
}));

vi.mock('../../../Service/APIClient', () => ({
  extractErrorMsg: (e: unknown) => String(e),
  default: {
    shared: {
      post: (...a: any[]) => hoisted.create(...a),
      put: (...a: any[]) => hoisted.update(...a),
    },
  },
}));

vi.mock('wukongimjssdk', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    WKSDK: {
      shared: () => ({
        channelManager: {
          getSubscribes: () => hoisted.subscribers,
          syncSubscribes: () => Promise.resolve(),
          getChannelInfo: () => undefined,
        },
      }),
    },
  };
});

import WebhookEditModal from '../WebhookEditModal';

let container: HTMLDivElement;

beforeEach(() => {
  i18n.setLocale('zh-CN', { notify: false, persist: false });
  hoisted.create.mockReset().mockResolvedValue({ webhook_id: 'iwh_new', token: 't', url: '/u' });
  hoisted.update.mockReset().mockResolvedValue(undefined);
  // 注意：订阅列表故意不含 self('me')——验证组件会显式把当前用户补进候选。
  hoisted.subscribers = [
    { uid: 'u1', name: 'Alice' },
    { uid: 'u2', name: 'Bob' },
    { uid: 'bot1', name: 'HelperBot', orgData: { robot: 1 } },
  ];
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { ReactDOM.unmountComponentAtNode(container); });
  container.remove();
});

const flush = async (): Promise<void> => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

const render = async (props: any): Promise<void> => {
  act(() => {
    ReactDOM.render(
      React.createElement(WebhookEditModal, {
        channel: {} as any,
        isManager: true,
        onClose: vi.fn(),
        onSaved: vi.fn(),
        ...props,
      }),
      container
    );
  });
  await flush();
};

const clickSave = (): void => {
  const saveBtn = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent === '保存'
  )!;
  act(() => { saveBtn.click(); });
};

describe('WebhookEditModal mention_uids picker', () => {
  it('lists group members and explicitly includes the current user (not in subscribers)', async () => {
    await render({});
    expect(container.querySelector('[data-testid="opt-u1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="opt-u2"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="opt-bot1"]')).not.toBeNull();
    // 自己不在群订阅缓存里，但应被显式补为可选项（合法的自动 @ 目标）
    expect(container.querySelector('[data-testid="opt-me"]')).not.toBeNull();
  });

  it('flags bot members with the AI badge', async () => {
    await render({});
    const botOpt = container.querySelector('[data-testid="opt-bot1"]')!;
    expect(botOpt.querySelector('.ai-badge')).not.toBeNull();
    const humanOpt = container.querySelector('[data-testid="opt-u1"]')!;
    expect(humanOpt.querySelector('.ai-badge')).toBeNull();
  });

  it('create: selected members are sent as mention_uids', async () => {
    await render({});
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="opt-u1"]')!.click();
    });
    await flush();
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="opt-bot1"]')!.click();
    });
    await flush();
    clickSave();
    await flush();

    expect(hoisted.create).toHaveBeenCalledTimes(1);
    const req = hoisted.create.mock.calls[0][1];
    expect(req.mention_uids).toEqual(['u1', 'bot1']);
  });

  it('edit: clearing all selections sends an explicit empty array', async () => {
    await render({
      webhook: {
        webhook_id: 'iwh_1',
        group_no: 'g',
        name: 'CI',
        avatar: '',
        creator_uid: 'u9',
        status: 1,
        last_used_at: 0,
        call_count: 0,
        created_at: 0,
        mention_uids: ['u1', 'u2'],
      },
    });
    // 取消两个已选 → 清空
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="opt-u1"]')!.click();
    });
    await flush();
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="opt-u2"]')!.click();
    });
    await flush();
    clickSave();
    await flush();

    expect(hoisted.update).toHaveBeenCalledTimes(1);
    const req = hoisted.update.mock.calls[0][1];
    expect(req.mention_uids).toEqual([]);
  });

  it('edit: no changes → no request (modal just closes)', async () => {
    await render({
      webhook: {
        webhook_id: 'iwh_1',
        group_no: 'g',
        name: 'CI',
        avatar: '',
        creator_uid: 'u9',
        status: 1,
        last_used_at: 0,
        call_count: 0,
        created_at: 0,
        mention_uids: ['u1'],
      },
    });
    clickSave();
    await flush();
    expect(hoisted.update).not.toHaveBeenCalled();
  });
});

describe('WebhookEditModal name input Enter / IME composition (#500)', () => {
  const nameInput = (): HTMLInputElement =>
    container.querySelectorAll<HTMLInputElement>('.wk-webhook-form__input')[0];

  const pressEnter = (isComposing: boolean): void => {
    act(() => {
      nameInput().dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          isComposing,
          bubbles: true,
          cancelable: true,
        })
      );
    });
  };

  it('does NOT submit when Enter fires during IME composition (选词/上屏)', async () => {
    await render({});
    // 中文拼音等输入法组字过程中的回车仅用于上屏候选，不应触发创建。
    pressEnter(true);
    await flush();
    expect(hoisted.create).not.toHaveBeenCalled();
  });

  it('submits when Enter fires outside composition', async () => {
    await render({});
    // 非组字状态下的回车仍应正常提交创建（名称可留空，服务端自动命名）。
    pressEnter(false);
    await flush();
    expect(hoisted.create).toHaveBeenCalledTimes(1);
  });
});
