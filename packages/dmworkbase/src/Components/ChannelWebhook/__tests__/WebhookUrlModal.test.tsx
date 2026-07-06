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

const render = async (): Promise<void> => {
  act(() => {
    ReactDOM.render(
      React.createElement(WebhookUrlModal, { resp, onClose: vi.fn() }),
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
  it('renders one example group per adapter row (native/github/wecom)', async () => {
    await render();
    expect(
      container.querySelectorAll('.wk-webhook-url__example-group')
    ).toHaveLength(3);
  });

  it('github row renders setup steps + Payload URL, NOT a curl block', async () => {
    await render();
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
