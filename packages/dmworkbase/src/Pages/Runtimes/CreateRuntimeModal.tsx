import React, { useEffect, useState } from 'react';
import { Modal, Toast } from '@douyinfe/semi-ui';
import WKApp from '../../App';

// CreateRuntimeModal — Onboarding modal that replaces the BotFather IM
// `/daemon` command. Calls GET /v1/runtime-onboarding to fetch the user's
// api_key (lazy-create) + service URLs, then renders the install + start
// commands for the user to copy + run on their machine.
//
// Backend contract (server: feat/runtime-onboarding-endpoint):
//   {
//     api_key, space_id,
//     server_url, fleet_url, matter_url,
//     commands: { install, start },
//     env_vars: { OCTO_SERVER_URL, OCTO_FLEET_URL }
//   }

interface OnboardingResp {
  api_key: string;
  space_id: string;
  server_url: string;
  fleet_url: string;
  matter_url: string;
  commands: {
    install: string;
    start: string;
  };
  env_vars: Record<string, string>;
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function CreateRuntimeModal({ visible, onClose }: Props) {
  const [data, setData] = useState<OnboardingResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setError(null);
    setData(null);
    const spaceId = WKApp.shared.currentSpaceId;
    WKApp.apiClient
      .get('/runtime-onboarding', { param: { space_id: spaceId } })
      .then((resp: OnboardingResp) => setData(resp))
      .catch((e: any) => setError(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, [visible]);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      Toast.success(`已复制：${label}`);
    } catch {
      Toast.error('复制失败，请手动选中');
    }
  };

  // server 直接返 standalone start block (含 export OCTO_*_URL + octo-daemon
  // 启动行), 直接用 commands.start 字段, 不在前端拼.
  const fullStartBlock = data?.commands.start ?? '';

  return (
    <Modal
      title="创建 Runtime"
      visible={visible}
      onCancel={onClose}
      footer={null}
      width={640}
    >
      <div className="wk-rt-onb">
        <p className="wk-rt-onb__lead">
          在你的电脑或服务器上运行下面的命令，让本机的 Claude Code / Codex /
          OpenClaw / Hermes 注册到 Octo 平台。
        </p>

        {loading && (
          <div className="wk-rt-onb__placeholder">正在生成启动命令…</div>
        )}

        {error && (
          <div className="wk-rt-onb__error" role="alert">
            获取启动命令失败：{error}
          </div>
        )}

        {data && (
          <>
            <Section
              title="① 安装"
              hint="Node.js ≥ 18"
              cmd={data.commands.install}
              onCopy={() => copy(data.commands.install, '安装命令')}
            />
            <Section
              title="② 启动"
              hint="macOS / Linux"
              cmd={fullStartBlock}
              onCopy={() => copy(fullStartBlock, '启动命令')}
            />

            <div className="wk-rt-onb__note">
              如果这台机器跟 server 不在同一台主机，把 URL 中的 host
              换成实际可达的地址；启动后回到本页面，新 daemon
              注册的 runtime 会出现在列表里。
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

interface SectionProps {
  title: string;
  hint: string;
  cmd: string;
  onCopy: () => void;
}

function Section({ title, hint, cmd, onCopy }: SectionProps) {
  return (
    <section className="wk-rt-onb__section">
      <header className="wk-rt-onb__section-head">
        <span className="wk-rt-onb__section-title">{title}</span>
        <span className="wk-rt-onb__section-hint">{hint}</span>
        <button
          type="button"
          className="wk-rt-onb__copy"
          onClick={onCopy}
          aria-label={`复制 ${title}`}
        >
          复制
        </button>
      </header>
      <pre className="wk-rt-onb__code">{cmd}</pre>
    </section>
  );
}
