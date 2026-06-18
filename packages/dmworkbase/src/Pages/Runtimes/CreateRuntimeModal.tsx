import React from 'react';
import { Modal, Toast } from '@douyinfe/semi-ui';
import WKApp from '../../App';
import { t } from '../../i18n';
import { copyToClipboard } from '../../Utils/clipboard';
import { getInstallGuide, buildInstallCopyText } from './installGuide';

// CreateRuntimeModal — 新增 Runtime 的安装指导弹框。蹭 installGuide 的
// octo_daemon 条目, 展示「安装 octo-daemon → 配置 → 启动」三步(i18n)。
// 打开时拉一次 /runtime-onboarding 取 space 的 api_key 填进配置命令;
// server-url 由前端从 apiClient.config.apiURL 推导(见 deriveServerUrl)。

// daemon 的 OCTO_SERVER_URL 是对外可达基址(不含 /v1, daemon 自己拼 /v1、
// /fleet/api)。apiClient.config.apiURL: web 是相对的 "/api/v1/", electron 是
// 绝对的 "<origin>/v1/"。统一解析成绝对 URL 再取 .origin:
//   web      → 当前浏览器 origin (/api/v1 是浏览器约定, daemon 走原生 /v1)
//   electron → VITE_API_URL 的 origin (如 http://127.0.0.1:3000)
function deriveServerUrl(): string {
  try {
    return new URL(WKApp.apiClient.config.apiURL, window.location.origin).origin;
  } catch {
    return window.location.origin;
  }
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function CreateRuntimeModal({ visible, onClose }: Props) {
  const [apiKey, setApiKey] = React.useState<string | undefined>(undefined);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchApiKey = React.useCallback(() => {
    setLoading(true);
    setError(null);
    WKApp.apiClient
      .get('/runtime-onboarding')
      .then((resp: { api_key?: string }) => {
        if (resp?.api_key) setApiKey(resp.api_key);
        else setError(t('base.runtimes.create.onboardingError'));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    if (!visible) return;
    setApiKey(undefined);
    fetchApiKey();
  }, [visible, fetchApiKey]);

  const copy = async (text: string, label: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      Toast.success({ content: t('base.runtimes.common.copied', { values: { text: label } }), duration: 2 });
    } else {
      Toast.warning({ content: t('base.runtimes.common.clipboardUnsupported'), duration: 2 });
    }
  };

  const vars = { apiUrl: deriveServerUrl(), apiKey };
  const guide = getInstallGuide('octo_daemon', vars);

  return (
    <Modal
      title={t('base.runtimes.create.createRuntime')}
      visible={visible}
      onCancel={onClose}
      footer={null}
      width={640}
    >
      <div className="wk-rt-onb">
        {loading && <div className="wk-rt-onb__placeholder">{t('base.runtimes.common.loading')}</div>}

        {!loading && error && (
          <div className="wk-rt-onb__error" role="alert">
            <span>{t('base.runtimes.create.onboardingError')}</span>
            <button type="button" className="wk-rt-onb__copy" onClick={fetchApiKey}>
              {t('base.runtimes.common.retry')}
            </button>
          </div>
        )}

        {!loading && !error && guide && (
          <>
            <div className="wk-rt-onb__section-head">
              <span className="wk-rt-onb__lead">{t(guide.introKey)}</span>
              <button
                type="button"
                className="wk-rt-onb__copy"
                onClick={() => copy(buildInstallCopyText('octo_daemon', t, vars), t('base.runtimes.install.copyAllLabel'))}
              >
                {t('base.runtimes.install.copyAll')}
              </button>
            </div>

            {guide.steps.map((step, i) => (
              <section className="wk-rt-onb__section" key={i}>
                <header className="wk-rt-onb__section-head">
                  <span className="wk-rt-onb__section-title">{`${i + 1}. ${t(step.titleKey)}`}</span>
                  {step.command && (
                    <button
                      type="button"
                      className="wk-rt-onb__copy"
                      onClick={() => copy(step.command!, t(step.titleKey))}
                      aria-label={t('base.runtimes.install.copyStep')}
                    >
                      {t('base.runtimes.install.copyStep')}
                    </button>
                  )}
                </header>
                {step.command && <pre className="wk-rt-onb__code">{step.command}</pre>}
                {step.noteKey && <div className="wk-rt-onb__note">{t(step.noteKey)}</div>}
              </section>
            ))}
          </>
        )}
      </div>
    </Modal>
  );
}
