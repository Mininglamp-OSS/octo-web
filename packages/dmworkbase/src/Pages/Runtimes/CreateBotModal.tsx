import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Toast } from '@douyinfe/semi-ui';
import { createBot, RuntimeKind } from './botsApi';

interface RuntimeOption {
  id: number;
  name: string;
  kind: RuntimeKind;
  supported: boolean;
}

interface Props {
  visible: boolean;
  runtimes: RuntimeOption[];
  onClose: () => void;
  onCreated: (botId: number) => void;
}

export function CreateBotModal({ visible, runtimes, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [runtimeId, setRuntimeId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setName('');
      setRuntimeId(runtimes.find(r => r.supported)?.id ?? null);
      setBusy(false);
    }
  }, [visible, runtimes]);

  const selected = useMemo(() => runtimes.find(r => r.id === runtimeId) ?? null, [runtimes, runtimeId]);
  const canSubmit = !!name.trim() && !!selected && selected.supported && !busy;

  const handleSubmit = async () => {
    if (!canSubmit || !selected) return;
    setBusy(true);
    try {
      const bot = await createBot({
        runtime_id: selected.id,
        name: name.trim(),
        runtime_kind: selected.kind,
      });
      Toast.success(`已创建：${bot.name}`);
      onCreated(bot.id);
      onClose();
    } catch (e: any) {
      Toast.error(`创建失败：${String(e?.message || e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="新建智能体"
      visible={visible}
      onCancel={onClose}
      onOk={handleSubmit}
      okText={busy ? '创建中…' : '创建'}
      okButtonProps={{ disabled: !canSubmit }}
      maskClosable={!busy}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 6 }}>名称</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="如：dev / reviewer / writer"
            style={{
              width: '100%', padding: '6px 10px',
              border: '1px solid #e5e5e5',
              borderRadius: 6, fontSize: 13, boxSizing: 'border-box',
            }}
            disabled={busy}
            autoFocus
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 6 }}>运行时</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {runtimes.length === 0 && (
              <span style={{ color: '#888', fontSize: 12 }}>本机暂无可用运行时</span>
            )}
            {runtimes.map(r => (
              <label
                key={r.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 10px',
                  border: '1px solid ' + (runtimeId === r.id ? '#1a1a1a' : '#e5e5e5'),
                  borderRadius: 6,
                  cursor: r.supported ? 'pointer' : 'not-allowed',
                  opacity: r.supported ? 1 : 0.5,
                }}
              >
                <input
                  type="radio"
                  checked={runtimeId === r.id}
                  onChange={() => r.supported && setRuntimeId(r.id)}
                  disabled={!r.supported || busy}
                />
                <span style={{ fontWeight: 500 }}>{r.name}</span>
                <span style={{ fontSize: 11, color: '#888' }}>{r.kind}</span>
                {!r.supported && (
                  <span style={{
                    marginLeft: 'auto',
                    fontSize: 11, padding: '1px 6px',
                    background: '#f0f0f0', borderRadius: 3, color: '#888',
                  }}>暂不支持</span>
                )}
              </label>
            ))}
          </div>
        </div>
        {selected?.supported && selected.kind === 'openclaw' && (
          <div style={{ fontSize: 11, color: '#888' }}>
            openclaw workspace 名将自动派生（隐藏在内部）
          </div>
        )}
      </div>
    </Modal>
  );
}
