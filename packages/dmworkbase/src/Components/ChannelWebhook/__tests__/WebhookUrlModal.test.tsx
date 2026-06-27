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
    // 折叠按钮展示适配器短名（此处只折叠了 github → "GitHub"）。
    expect(toggle!.textContent).toContain('GitHub');
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
    // 折叠按钮展示适配器短名；4 个未超上限 4 → 全列出、不加「等」。
    expect(toggle!.textContent).toContain('GitHub');
    expect(toggle!.textContent).toContain('Multica');
    expect(toggle!.textContent).not.toContain('等');
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

// resp 带服务端下发的 adapter_examples（octo-server #475）：「更多适配器」改由它驱动，
// 文案/steps/header 名均来自响应，不再走写死 i18n。
const respWithExamples: any = {
  url: '/v1/incoming-webhooks/iwh_test/tok',
  token: 'tok',
  urls: {
    native: '/v1/incoming-webhooks/iwh_test/tok',
    wecom: '/v1/incoming-webhooks/iwh_test/tok/wecom',
  },
  adapter_examples: [
    {
      key: 'github',
      title: 'GitHub 事件 SRV',
      description: 'desc-github-srv',
      url: '/v1/incoming-webhooks/iwh_test/tok/github',
      content_type: 'application/json',
      auth: { type: 'url_token' },
      steps: ['gh-s1', 'gh-s2', 'gh-s3'],
    },
    {
      key: 'gitlab',
      title: 'GitLab 事件 SRV',
      description: 'desc-gitlab-srv',
      url: '/v1/incoming-webhooks/iwh_test/tok/gitlab',
      content_type: 'application/json',
      auth: { type: 'url_token_and_header', header: 'X-Gitlab-Token', value_source: 'token' },
      steps: ['gl-s1', 'gl-s2'],
    },
    // wecom 被后端纳入示例，但前端按 Option A 仍作核心 curl 卡片，应从「更多适配器」过滤掉。
    {
      key: 'wecom',
      title: 'WeCom SRV',
      description: 'desc-wecom-srv',
      url: '/v1/incoming-webhooks/iwh_test/tok/wecom',
      content_type: 'application/json',
      auth: { type: 'url_token' },
      steps: ['wc-s1'],
    },
  ],
};

describe('WebhookUrlModal server-driven adapter examples (#475)', () => {
  it('drives the more-adapters region from adapter_examples; wecom stays a core curl (Option A)', async () => {
    await render(respWithExamples);
    // 核心区仍是 native + wecom 两组（wecom 不进「更多适配器」）。
    expect(
      container.querySelectorAll('.wk-webhook-url__example-group')
    ).toHaveLength(2);
    const toggle = container.querySelector<HTMLButtonElement>(
      '.wk-webhook-url__more-toggle'
    );
    // 折叠按钮列出适配器短名（服务端示例去掉 wecom → GitHub、GitLab，2 个未超上限不加「等」）。
    expect(toggle!.textContent).toContain('GitHub');
    expect(toggle!.textContent).toContain('GitLab');
    expect(toggle!.textContent).not.toContain('等');
    // 折叠态下服务端示例文案不在 DOM。
    expect(container.textContent).not.toContain('desc-github-srv');
  });

  it('renders server title/description/steps + GitLab header+token hint after expand', async () => {
    await render(respWithExamples);
    act(() => {
      container
        .querySelector<HTMLButtonElement>('.wk-webhook-url__more-toggle')!
        .click();
    });
    await flush();

    // 2 核心 + 2 服务端 = 4 组。
    expect(
      container.querySelectorAll('.wk-webhook-url__example-group')
    ).toHaveLength(4);

    // 文案来自服务端，且 steps 按数组渲染（github 3 步）。
    expect(container.textContent).toContain('GitHub 事件 SRV');
    expect(container.textContent).toContain('desc-github-srv');
    const groups = Array.from(
      container.querySelectorAll<HTMLElement>('.wk-webhook-url__example-group')
    );
    const githubGroup = groups.find((g) =>
      (g.querySelector('code.wk-webhook-url__value')?.textContent || '').includes('/tok/github')
    )!;
    expect(githubGroup.querySelector('pre.wk-webhook-url__example-code')).toBeNull();
    // 步骤默认收起：先只看到「接入步骤」折叠按钮，<ol> 不在 DOM。
    expect(githubGroup.querySelector('.wk-webhook-url__steps')).toBeNull();
    const stepsToggle = githubGroup.querySelector<HTMLButtonElement>(
      '.wk-webhook-url__steps-toggle'
    )!;
    expect(stepsToggle).not.toBeNull();
    // 展开该卡片步骤后，按服务端数组渲染（github 3 步）。
    act(() => { stepsToggle.click(); });
    await flush();
    expect(githubGroup.querySelectorAll('.wk-webhook-url__steps > li')).toHaveLength(3);

    // GitLab：渲染服务端给的 header 名 + 可复制的 token（前端不写死 X-Gitlab-Token）。
    const gitlabGroup = groups.find((g) =>
      (g.querySelector('code.wk-webhook-url__value')?.textContent || '').includes('/tok/gitlab')
    )!;
    expect(gitlabGroup.querySelector('.wk-webhook-url__auth-hint')).not.toBeNull();
    expect(gitlabGroup.textContent).toContain('X-Gitlab-Token');
    const codes = Array.from(
      gitlabGroup.querySelectorAll<HTMLElement>('code.wk-webhook-url__value')
    ).map((c) => c.textContent);
    expect(codes).toContain('tok');
  });

  it('still renders native/wecom as core curls (server examples do not replace them)', async () => {
    await render(respWithExamples);
    const pres = Array.from(
      container.querySelectorAll<HTMLPreElement>('pre.wk-webhook-url__example-code')
    );
    expect(pres.find((p) => /"content"/.test(p.textContent || ''))).toBeTruthy();
    expect(pres.find((p) => /msgtype/.test(p.textContent || ''))).toBeTruthy();
  });

  it('truncates the teaser with 等 only when foldable adapters exceed the cap (>4)', async () => {
    // 5 个可折叠适配器（含 1 个未知 key）→ 列前 4 个短名 + 「等」。
    const mk = (key: string) => ({
      key,
      title: `${key} 事件 SRV`,
      description: `desc-${key}`,
      url: `/v1/incoming-webhooks/iwh_test/tok/${key}`,
      content_type: 'application/json',
      auth: { type: 'url_token' },
      steps: [`${key}-s1`],
    });
    const resp5: any = {
      url: '/v1/incoming-webhooks/iwh_test/tok',
      token: 'tok',
      urls: { native: '/v1/incoming-webhooks/iwh_test/tok' },
      adapter_examples: ['github', 'gitlab', 'feishu', 'multica', 'slack'].map(mk),
    };
    await render(resp5);
    const toggle = container.querySelector<HTMLButtonElement>(
      '.wk-webhook-url__more-toggle'
    )!;
    // 已知 key 用短名（飞书），未知 key（slack）被「等」收口、不出现在 teaser。
    expect(toggle.textContent).toContain('飞书');
    expect(toggle.textContent).toContain('等');
    expect(toggle.textContent).not.toContain('slack');
  });
});
