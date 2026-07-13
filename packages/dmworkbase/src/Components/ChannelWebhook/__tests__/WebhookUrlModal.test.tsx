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
  IconEyeClosed: () => React.createElement('span', { 'data-testid': 'icon-eye-closed' }),
  IconEyeOpened: () => React.createElement('span', { 'data-testid': 'icon-eye-opened' }),
  IconTickCircle: () => React.createElement('span', { 'data-testid': 'icon-tick' }),
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

const clickAdapterTab = async (name: string): Promise<void> => {
  const tabs = Array.from(
    container.querySelectorAll<HTMLButtonElement>('.wk-webhook-url__tab')
  );
  const tab = tabs.find((el) => el.textContent?.includes(name));
  if (!tab) throw new Error(`no adapter tab contains ${name}`);
  act(() => { tab.click(); });
  await flush();
};

// 眼睛 toggle 统一治理整个弹窗的 secret 展示：默认遮罩，示例区 URL/token 也被隐藏。
// 需要断言明文内容时先揭示。幂等：仅在当前处于隐藏态时点击。
const revealSecrets = async (): Promise<void> => {
  const eye = container.querySelector<HTMLButtonElement>('[aria-label="显示明文"]');
  if (eye) {
    act(() => { eye.click(); });
    await flush();
  }
};

describe('WebhookUrlModal renderExample branch mapping', () => {
  it('renders the short /v1/webhooks alias (not canonical /incoming-webhooks) for the push address (#452)', async () => {
    await render();
    const addr = container.querySelector(
      '.wk-webhook-url__row .wk-webhook-url__value'
    );
    // 默认掩码降低肩窥风险；点击眼睛后展示短别名，而不是 canonical /incoming-webhooks。
    expect(addr?.textContent).toContain('••••••••');
    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="显示明文"]')!.click();
    });
    await flush();
    expect(addr?.textContent).toContain('/api/v1/webhooks/iwh_test/tok');
    expect(addr?.textContent).not.toContain('/incoming-webhooks/');
  });

  it('copies the full URL from either the masked text row or copy icon', async () => {
    await render();
    const secretRow = container.querySelector<HTMLElement>('.wk-webhook-url__secret-row')!;
    const copyTargets = secretRow.querySelectorAll<HTMLButtonElement>(
      '[aria-label="复制"]'
    );
    expect(copyTargets).toHaveLength(2);

    act(() => { copyTargets[0].click(); });
    await flush();
    act(() => { copyTargets[1].click(); });
    await flush();

    expect(hoisted.copyToClipboard).toHaveBeenNthCalledWith(
      1,
      'http://localhost:3000/api/v1/webhooks/iwh_test/tok'
    );
    expect(hoisted.copyToClipboard).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3000/api/v1/webhooks/iwh_test/tok'
    );
  });

  it('shows adapter tabs by default while rendering only the native content panel', async () => {
    await render();
    // Tab 全量可见，但内容区只有一个，默认展示 native。
    const tabs = Array.from(container.querySelectorAll('.wk-webhook-url__tab'));
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      '通用',
      'GitHub',
      '企业微信',
    ]);
    expect(
      container.querySelectorAll('.wk-webhook-url__example-group')
    ).toHaveLength(1);
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain(
      '通用'
    );
    expect(container.textContent).not.toContain('/tok/github');
    expect(container.textContent).not.toContain('/tok/wecom');
  });

  it('supports keyboard navigation across adapter tabs', async () => {
    await render();
    const tabs = () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('.wk-webhook-url__tab'));
    act(() => {
      tabs()[0].dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowRight',
          bubbles: true,
        })
      );
    });
    await flush();
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain(
      'GitHub'
    );

    act(() => {
      tabs()[1].dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'End',
          bubbles: true,
        })
      );
    });
    await flush();
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain(
      '企业微信'
    );
  });

  it('github row renders setup steps + Payload URL only after switching to its tab', async () => {
    await render();
    expect(container.textContent).not.toContain('/tok/github');

    await clickAdapterTab('GitHub');
    const githubGroup = groupContaining('.wk-webhook-url__steps');
    // github 用法是「贴 Payload URL + 步骤」，不应渲染 curl <pre>。
    expect(githubGroup.querySelector('pre.wk-webhook-url__example-code')).toBeNull();
    expect(githubGroup.querySelectorAll('.wk-webhook-url__steps > li')).toHaveLength(3);
    expect(
      githubGroup.querySelector<HTMLDetailsElement>('.wk-webhook-url__steps-details')!.open
    ).toBe(false);
    // 默认遮罩：Payload URL 以掩码呈现，揭示后才是完整地址。
    expect(
      githubGroup.querySelector('code.wk-webhook-url__value')?.textContent
    ).toContain('••••••••');
    await revealSecrets();
    const code = groupContaining('.wk-webhook-url__steps').querySelector(
      'code.wk-webhook-url__value'
    );
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

  it('wecom row renders a curl with WeCom msgtype/text body after clicking its adapter card', async () => {
    await render();
    await clickAdapterTab('企业微信');
    const pres = Array.from(
      container.querySelectorAll<HTMLPreElement>('pre.wk-webhook-url__example-code')
    );
    const wecomPre = pres.find((p) => /msgtype/.test(p.textContent || ''));
    expect(wecomPre).toBeTruthy();
    expect(wecomPre!.textContent).toContain('"text"');
    expect(wecomPre!.textContent).toContain('curl -X POST');
  });
});

describe('WebhookUrlModal masking (secret never leaks while hidden) (#594)', () => {
  it('keeps the full tokenized URL out of the DOM — text, curl <pre>, and title — while masked', async () => {
    await render();
    const fullUrl = 'http://localhost:3000/api/v1/webhooks/iwh_test/tok';
    // 默认遮罩态：完整地址不出现在任何可见文本里（native 是默认 Tab，其 curl <pre> 也在内）。
    expect(container.textContent).not.toContain(fullUrl);
    expect(container.textContent).not.toContain('iwh_test/tok');
    // 且不落在任何 title 属性上（hover tooltip 也不会明文弹出 secret）。
    const withTitle = Array.from(container.querySelectorAll<HTMLElement>('[title]'));
    expect(
      withTitle.some((el) => (el.getAttribute('title') || '').includes('iwh_test/tok'))
    ).toBe(false);
    // 默认 native curl <pre>：命令结构仍在，但 URL 段被遮罩。
    const pre = container.querySelector('pre.wk-webhook-url__example-code');
    expect(pre?.textContent).toContain('curl -X POST');
    expect(pre?.textContent).not.toContain('iwh_test/tok');
    // 点眼睛揭示后，完整地址（含 curl 内）才出现——复制功能不受影响。
    await revealSecrets();
    expect(container.textContent).toContain(fullUrl);
    expect(
      container.querySelector('pre.wk-webhook-url__example-code')?.textContent
    ).toContain('iwh_test/tok');
  });

  it('masks the one-time auth token (text + title) until revealed', async () => {
    await render(respWithExamples);
    await clickAdapterTab('GitLab');
    // 遮罩态：auth-hint 里的一次性 token 以掩码呈现，且 title 不带明文 token。
    let tokenCode = container.querySelector<HTMLElement>(
      '.wk-webhook-url__auth-hint code.wk-webhook-url__value'
    )!;
    expect(tokenCode.textContent).toBe('••••••••');
    expect(tokenCode.getAttribute('title')).toBeNull();
    // 揭示后展示完整 token。
    await revealSecrets();
    tokenCode = container.querySelector<HTMLElement>(
      '.wk-webhook-url__auth-hint code.wk-webhook-url__value'
    )!;
    expect(tokenCode.textContent).toBe('tok');
  });

  // 回归：token 是 URL 的路径段/裸值，遮罩必须整段隐藏 token，绝不暴露其任何
  // 前缀/后缀。旧版首12+末6 的按位置遮罩会泄露 token 末 6 字符（#594 review）。
  // 用真实长度 token 才能结构性地抓到后缀泄露——短 token 会整段落进掩码中间，测不出。
  it('masks the entire token segment — never a prefix/suffix — for a realistic-length token', async () => {
    const longTok = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6'; // 32 chars
    const r: any = {
      url: `/v1/incoming-webhooks/iwh_test/${longTok}`,
      token: longTok,
      urls: {
        native: `/v1/incoming-webhooks/iwh_test/${longTok}`,
        github: `/v1/incoming-webhooks/iwh_test/${longTok}/github`,
      },
    };
    await render(r);
    const masked = container.textContent || '';
    // token 的任何子串都不得出现——包括旧版会泄露的首/末 6 字符（默认 native tab 的
    // 地址行与 curl <pre> 都在 textContent 内）。
    expect(masked).not.toContain(longTok);
    expect(masked).not.toContain(longTok.slice(-6));
    expect(masked).not.toContain(longTok.slice(0, 6));
    // 但非秘密的结构前缀（webhook id）保留，便于识别。
    expect(masked).toContain('iwh_test');
    // 揭示后完整 token 才出现。
    await revealSecrets();
    expect(container.textContent).toContain(longTok);
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

// resp 额外带上新增适配器（gitlab/feishu/multica），用于 Tab 切换行为验证。
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

describe('WebhookUrlModal adapter tabs', () => {
  it('renders github/gitlab/feishu/multica/wecom as sibling tabs while only native content is shown by default', async () => {
    await render(respWithExtra);
    const tabs = Array.from(
      container.querySelectorAll<HTMLElement>('.wk-webhook-url__tab')
    ).map((tab) => tab.textContent);
    expect(tabs).toEqual([
      '通用',
      'GitHub',
      'GitLab',
      '飞书',
      'Multica',
      '企业微信',
    ]);
    expect(
      container.querySelectorAll('.wk-webhook-url__example-group')
    ).toHaveLength(1);
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain(
      '通用'
    );
    expect(container.textContent).not.toContain('/tok/github');
    expect(container.textContent).not.toContain('/tok/wecom');
    expect(container.textContent).not.toContain('/tok/gitlab');
  });

  it('keeps a single content panel when switching among adapter tabs', async () => {
    await render(respWithExtra);
    expect(container.querySelectorAll('.wk-webhook-url__adapter-card')).toHaveLength(0);
    await clickAdapterTab('飞书');
    expect(
      container.querySelectorAll('.wk-webhook-url__example-group')
    ).toHaveLength(1);
    await revealSecrets();
    expect(container.textContent).toContain('/tok/feishu');
    expect(container.textContent).not.toContain('/tok/github');
    expect(container.textContent).not.toContain('/tok/wecom');
    expect(container.textContent).not.toContain('/tok/gitlab');
    expect(container.textContent).not.toContain('/tok/multica');
  });

  it('reveals only the selected adapter detail and keeps gitlab without curl or setup steps', async () => {
    await render(respWithExtra);
    await clickAdapterTab('GitLab');
    await revealSecrets();

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
    // 只展开被点击的平台。
    expect(container.textContent).not.toContain('/tok/github');
    expect(container.textContent).not.toContain('/tok/feishu');
  });
});

// resp 带服务端下发的 adapter_examples（octo-server #475）：适配器 Tab 由它驱动，
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
    // wecom 被后端纳入示例，但前端按 Option A 仍走专用 curl 渲染。
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
  it('drives adapter tabs from adapter_examples; wecom still uses the frontend curl renderer', async () => {
    await render(respWithExamples);
    // 默认只渲染 native 内容，服务端示例和 wecom 都作为 Tab 可见。
    expect(
      container.querySelectorAll('.wk-webhook-url__example-group')
    ).toHaveLength(1);
    const tabs = Array.from(
      container.querySelectorAll<HTMLElement>('.wk-webhook-url__tab')
    ).map((tab) => tab.textContent);
    expect(tabs).toEqual(['通用', 'GitHub', 'GitLab', '企业微信']);
    expect(container.textContent).not.toContain('desc-github-srv');
  });

  it('renders server title/description/steps + GitLab header+token hint after switching tabs', async () => {
    await render(respWithExamples);
    expect(container.textContent).not.toContain('desc-github-srv');

    // 文案来自服务端，且 steps 按数组渲染（github 3 步）。
    await clickAdapterTab('GitHub');
    expect(
      container.querySelector<HTMLElement>('[role="tabpanel"]')?.getAttribute('aria-label')
    ).toBe('GitHub 事件 SRV');
    expect(container.textContent).toContain('desc-github-srv');
    // 揭示明文后才能按 URL 文本定位面板；showWebhookUrl 为组件级状态，切换 Tab 保持。
    await revealSecrets();
    let groups = Array.from(
      container.querySelectorAll<HTMLElement>('.wk-webhook-url__example-group')
    );
    const githubGroup = groups.find((g) =>
      (g.querySelector('code.wk-webhook-url__value')?.textContent || '').includes('/tok/github')
    )!;
    expect(githubGroup.querySelector('pre.wk-webhook-url__example-code')).toBeNull();
    // 步骤使用原生 details，默认收起，但内容保留在 details 内。
    const details = githubGroup.querySelector<HTMLDetailsElement>(
      '.wk-webhook-url__steps-details'
    )!;
    expect(details.open).toBe(false);
    expect(githubGroup.querySelectorAll('.wk-webhook-url__steps > li')).toHaveLength(3);

    // GitLab：渲染服务端给的 header 名 + 可复制的 token（前端不写死 X-Gitlab-Token）。
    await clickAdapterTab('GitLab');
    groups = Array.from(
      container.querySelectorAll<HTMLElement>('.wk-webhook-url__example-group')
    );
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
    expect(pres.find((p) => /msgtype/.test(p.textContent || ''))).toBeFalsy();

    await clickAdapterTab('企业微信');
    const expandedPres = Array.from(
      container.querySelectorAll<HTMLPreElement>('pre.wk-webhook-url__example-code')
    );
    expect(expandedPres.find((p) => /msgtype/.test(p.textContent || ''))).toBeTruthy();
  });

  it('keeps unknown server adapters as additional tabs after known adapters', async () => {
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
    const tabs = Array.from(
      container.querySelectorAll<HTMLElement>('.wk-webhook-url__tab')
    ).map((tab) => tab.textContent);
    expect(tabs).toEqual([
      '通用',
      'GitHub',
      'GitLab',
      '飞书',
      'Multica',
      'slack 事件 SRV',
    ]);
  });
});
