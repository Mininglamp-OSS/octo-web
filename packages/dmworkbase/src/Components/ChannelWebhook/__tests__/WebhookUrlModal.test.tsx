/**
 * @vitest-environment jsdom
 *
 * WebhookUrlModal tests — cover the renderExample branch mapping (github vs
 * native/wecom) and the copy ✓ feedback state machine (lml2468 review nit).
 *
 * The real buildWebhookUrlRows / buildWebhookCurlExample are intentionally NOT
 * mocked: the point is to catch row.key → sampleKey/noteKey/body drift, i.e. that
 * github renders steps (no curl) while native/wecom render the correct curl body.
 *
 * React 17 + ReactDOM.render pattern (matches SecretsSettingsPanel.test.tsx).
 */
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { i18n } from '../../../i18n';

const hoisted = vi.hoisted(() => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
}));

vi.mock('@douyinfe/semi-ui', () => ({
  Toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@douyinfe/semi-icons', () => ({
  IconAlertTriangle: () => React.createElement('span', { 'data-testid': 'icon-alert' }),
  IconCopy: () => React.createElement('span', { 'data-testid': 'icon-copy' }),
  IconTickCircle: () => React.createElement('span', { 'data-testid': 'icon-tick' }),
  IconChevronDown: () => React.createElement('span', { 'data-testid': 'icon-chevron' }),
}));

vi.mock('../../WKModal', () => ({
  default: ({ children, visible }: any) =>
    visible ? React.createElement('div', { 'data-testid': 'modal' }, children) : null,
  __esModule: true,
}));

vi.mock('../../WKButton', () => ({
  default: ({ children, onClick }: any) =>
    React.createElement('button', { onClick }, children),
  __esModule: true,
}));

vi.mock('../../../App', () => ({
  default: { apiClient: { config: { apiURL: '/api/v1/' } } },
  __esModule: true,
}));

vi.mock('../../../Utils/clipboard', () => ({
  copyToClipboard: (...a: any[]) => hoisted.copyToClipboard(...a),
}));

import WebhookUrlModal from '../WebhookUrlModal';

// resp with all three adapter URLs → buildWebhookUrlRows yields native/github/wecom.
const resp: any = {
  url: '/v1/incoming-webhooks/iwh_test/tok',
  urls: {
    native: '/v1/incoming-webhooks/iwh_test/tok',
    github: '/v1/incoming-webhooks/iwh_test/tok/github',
    wecom: '/v1/incoming-webhooks/iwh_test/tok/wecom',
  },
};

let container: HTMLDivElement;

beforeEach(() => {
  i18n.setLocale('zh-CN', { notify: false, persist: false });
  hoisted.copyToClipboard.mockReset().mockResolvedValue(true);
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

const render = async (r: any = resp): Promise<void> => {
  act(() => {
    ReactDOM.render(
      React.createElement(WebhookUrlModal, { resp: r, onClose: vi.fn() }),
      container
    );
  });
  // useEffect flips visible=true; flush so the modal children mount.
  await flush();
};

const groupContaining = (selector: string): HTMLElement => {
  const groups = Array.from(
    container.querySelectorAll<HTMLElement>('.wk-webhook-url__example-group')
  );
  const hit = groups.find((g) => g.querySelector(selector));
  if (!hit) throw new Error(`no example-group contains ${selector}`);
  return hit;
};

describe('WebhookUrlModal renderExample branch mapping', () => {
  it('renders the short /v1/webhooks alias (not canonical /incoming-webhooks) for the push address (#452)', async () => {
    await render();
    const addr = container.querySelector(
      '.wk-webhook-url__row .wk-webhook-url__value'
    );
    // 后端返回 canonical /v1/incoming-webhooks/...，展示层应改写成更短的等价别名。
    expect(addr?.textContent).toContain('/api/v1/webhooks/iwh_test/tok');
    expect(container.textContent).not.toContain('/incoming-webhooks/');
  });

  it('shows only native/wecom by default; github is folded behind the toggle', async () => {
    await render();
    // 默认展开的只有 native / wecom 两组；github 收进「更多适配器」折叠区。
    expect(
      container.querySelectorAll('.wk-webhook-url__example-group')
    ).toHaveLength(2);
    const toggle = container.querySelector<HTMLButtonElement>(
      '.wk-webhook-url__more-toggle'
    );
    expect(toggle).not.toBeNull();
    expect(toggle!.textContent).toContain('1');
    // 折叠态下 github 地址不在文档里。
    expect(container.textContent).not.toContain('/tok/github');
  });

  it('github row (after expand) renders setup steps + Payload URL, NOT a curl block', async () => {
    await render();
    act(() => {
      container
        .querySelector<HTMLButtonElement>('.wk-webhook-url__more-toggle')!
        .click();
    });
    await flush();
    const githubGroup = groupContaining('.wk-webhook-url__steps');
    // github 用法是「贴 Payload URL + 步骤」，不应渲染 curl <pre>。
    expect(githubGroup.querySelector('pre.wk-webhook-url__example-code')).toBeNull();
    expect(githubGroup.querySelectorAll('.wk-webhook-url__steps > li')).toHaveLength(3);
    const code = githubGroup.querySelector('code.wk-webhook-url__value');
    expect(code?.textContent).toContain('/github');
  });

  it('native row renders a curl with {"content":...} body', async () => {
    await render();
    const pres = Array.from(
      container.querySelectorAll<HTMLPreElement>('pre.wk-webhook-url__example-code')
    );
    const nativePre = pres.find((p) => /"content"/.test(p.textContent || ''));
    expect(nativePre).toBeTruthy();
    expect(nativePre!.textContent).toContain('curl -X POST');
    // native 走 content 结构，绝不能误用 wecom 的 msgtype。
    expect(nativePre!.textContent).not.toContain('msgtype');
  });

  it('wecom row renders a curl with WeCom msgtype/text body', async () => {
    await render();
    const pres = Array.from(
      container.querySelectorAll<HTMLPreElement>('pre.wk-webhook-url__example-code')
    );
    const wecomPre = pres.find((p) => /msgtype/.test(p.textContent || ''));
    expect(wecomPre).toBeTruthy();
    expect(wecomPre!.textContent).toContain('"text"');
    expect(wecomPre!.textContent).toContain('curl -X POST');
  });
});

describe('WebhookUrlModal copy feedback', () => {
  it('flips the copied example button icon to ✓ after a successful copy', async () => {
    await render();
    const copyBtn = container.querySelector<HTMLButtonElement>(
      '.wk-webhook-url__example-copy'
    )!;
    // 复制前是 copy 图标，不是 ✓。
    expect(copyBtn.querySelector('[data-testid="icon-tick"]')).toBeNull();
    expect(copyBtn.querySelector('[data-testid="icon-copy"]')).not.toBeNull();

    act(() => { copyBtn.click(); });
    await flush();

    expect(hoisted.copyToClipboard).toHaveBeenCalledTimes(1);
    const copiedBtn = container.querySelector<HTMLButtonElement>(
      '.wk-webhook-url__example-copy'
    )!;
    expect(copiedBtn.querySelector('[data-testid="icon-tick"]')).not.toBeNull();
  });
});

// resp 额外带上新增适配器（gitlab/feishu/multica），用于折叠区行为验证。
const respWithExtra: any = {
  url: '/v1/incoming-webhooks/iwh_test/tok',
  urls: {
    native: '/v1/incoming-webhooks/iwh_test/tok',
    github: '/v1/incoming-webhooks/iwh_test/tok/github',
    wecom: '/v1/incoming-webhooks/iwh_test/tok/wecom',
    gitlab: '/v1/incoming-webhooks/iwh_test/tok/gitlab',
    feishu: '/v1/incoming-webhooks/iwh_test/tok/feishu',
    multica: '/v1/incoming-webhooks/iwh_test/tok/multica',
  },
};

describe('WebhookUrlModal extra adapters collapse', () => {
  it('collapses github/gitlab/feishu/multica behind a toggle by default (only 2 core groups shown)', async () => {
    await render(respWithExtra);
    // 默认仅展示 native/wecom 两组；其余适配器收起、不在 DOM。
    expect(
      container.querySelectorAll('.wk-webhook-url__example-group')
    ).toHaveLength(2);
    const toggle = container.querySelector<HTMLButtonElement>(
      '.wk-webhook-url__more-toggle'
    );
    expect(toggle).not.toBeNull();
    // 折叠按钮带折叠适配器数量（github/gitlab/feishu/multica = 4）。
    expect(toggle!.textContent).toContain('4');
    // 折叠态下这些地址都不应出现在文档里。
    expect(container.textContent).not.toContain('/tok/github');
    expect(container.textContent).not.toContain('/tok/gitlab');
  });

  it('reveals the 4 folded adapters after expanding', async () => {
    await render(respWithExtra);
    const toggle = container.querySelector<HTMLButtonElement>(
      '.wk-webhook-url__more-toggle'
    )!;
    act(() => { toggle.click(); });
    await flush();

    // 展开后 2 核心 + 4 折叠 = 6 组。
    expect(
      container.querySelectorAll('.wk-webhook-url__example-group')
    ).toHaveLength(6);

    // 四个折叠适配器的地址均已出现在文档中。
    expect(container.textContent).toContain('/tok/github');
    expect(container.textContent).toContain('/tok/gitlab');
    expect(container.textContent).toContain('/tok/feishu');
    expect(container.textContent).toContain('/tok/multica');
  });

  it('does NOT render a curl block nor setup steps for gitlab/feishu/multica', async () => {
    await render(respWithExtra);
    act(() => {
      container
        .querySelector<HTMLButtonElement>('.wk-webhook-url__more-toggle')!
        .click();
    });
    await flush();

    // 找到包含 /tok/gitlab 的示例组，断言它既无 curl <pre> 也无 github 式步骤。
    const groups = Array.from(
      container.querySelectorAll<HTMLElement>('.wk-webhook-url__example-group')
    );
    const gitlabGroup = groups.find((g) =>
      (g.querySelector('code.wk-webhook-url__value')?.textContent || '').includes(
        '/tok/gitlab'
      )
    );
    expect(gitlabGroup).toBeTruthy();
    expect(gitlabGroup!.querySelector('pre.wk-webhook-url__example-code')).toBeNull();
    expect(gitlabGroup!.querySelector('.wk-webhook-url__steps')).toBeNull();
    // 应展示该适配器的说明文案。
    expect(gitlabGroup!.querySelector('.wk-webhook-url__example-note')).not.toBeNull();
  });
});
